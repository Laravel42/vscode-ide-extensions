#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FAILED=()
BUMP="${1:-patch}"  # pass "minor" or "patch" as first arg, defaults to patch

bump_version() {
  local pkg="$1"
  local kind="$2"
  local cur
  cur=$(grep -o '"version": *"[^"]*"' "$pkg" | head -1 | grep -o '[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*')
  
  IFS='.' read -r major minor patch <<< "$cur"
  
  if [ "$kind" = "minor" ]; then
    minor=$((minor + 1))
    patch=0
  else
    patch=$((patch + 1))
  fi

  local next="$major.$minor.$patch"
  sed -i '' "s/\"version\": *\"$cur\"/\"version\": \"$next\"/" "$pkg"
  echo "$next"
}

for dir in "$ROOT"/*/; do
  [ -f "$dir/package.json" ] || continue

  name="$(basename "$dir")"
  echo "── $name ──"

  cd "$dir"

  # install deps if needed
  [ -d node_modules ] || pnpm install --frozen-lockfile

  # bump version
  new_ver=$(bump_version package.json "$BUMP")
  echo "→ version $new_ver ($BUMP)"

  # build
  if pnpm run build; then
    echo "✓ $name built"
  else
    echo "✗ $name failed"
    FAILED+=("$name")
  fi

  # package vsix and install if script exists
  if grep -q '"package"' package.json; then
    yes | pnpm run package || true
    vsix=$(ls -t *.vsix 2>/dev/null | head -1)
    if [ -n "$vsix" ]; then
      kiro --install-extension "$vsix" --force
      echo "✓ $name installed ($vsix)"
    fi
  fi

  cd "$ROOT"
  echo ""
done

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Failed: ${FAILED[*]}"
  exit 1
fi

echo "All extensions rebuilt."
