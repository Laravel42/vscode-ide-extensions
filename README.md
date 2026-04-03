# L42 VS Code Extensions

A monorepo of VS Code / Kiro extensions built by L42. Each subdirectory is a self-contained extension with its own `package.json`, build pipeline, and VSIX output.

## Extensions

| Extension | Description | Version |
|-----------|-------------|---------|
| [dom-inspector](dom-inspector/) | Embed a browser in the editor, pick DOM elements, resolve them to source code, and build AI chat context | 0.4.3 |

## Quick start

```bash
# Rebuild, package, and install all extensions (patch bump)
./rebuild-all.sh

# Minor version bump instead
./rebuild-all.sh minor
```

The `rebuild-all.sh` script iterates over every subdirectory with a `package.json`, installs dependencies if needed, bumps the version, compiles, packages a VSIX, and installs it into Kiro.

## Repo structure

```
.
├── rebuild-all.sh          # Build + package + install all extensions
├── dom-inspector/          # DOM Inspector extension
│   ├── src/                # TypeScript source
│   ├── src/inspector/      # Injected browser-side modules
│   ├── tests/              # Property-based tests (fast-check + vitest)
│   ├── media/              # Icons and assets
│   ├── out/                # Compiled JS (git-ignored)
│   └── package.json
└── README.md
```

## Adding a new extension

1. Create a new directory at the root with a `package.json` containing `build` and `package` scripts.
2. Run `./rebuild-all.sh` — it will automatically pick up the new extension.

## Requirements

- Node.js ≥ 20
- pnpm
- VS Code ≥ 1.95.0 or Kiro
