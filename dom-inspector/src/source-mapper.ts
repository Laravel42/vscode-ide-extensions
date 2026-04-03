import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ElementData, SourceLocation } from './types';

/**
 * SourceMapper resolves a DOM element to its originating source file and line
 * using a prioritized strategy chain. Stops on first successful match.
 *
 * Strategy order:
 *   1. Source Map — componentInfo.sourceFile + sourceLine
 *   2. Framework Hook — search by ComponentName filename convention
 *   3. DOM Attribute — data-component, data-source, data-file, data-testid
 *   4. Grep Fallback — search by id, class names, text content
 */
export class SourceMapper {
  private static readonly STRATEGY_TIMEOUT_MS = 3000;

  private static readonly FRAMEWORK_EXTENSIONS = ['.tsx', '.jsx', '.vue', '.svelte'];

  private static readonly GREP_INCLUDE = [
    '*.tsx', '*.jsx', '*.vue', '*.svelte', '*.html',
  ];

  private static readonly GREP_EXCLUDE_DIRS = [
    'node_modules', '.git', 'dist', 'build',
  ];

  private static readonly SOURCE_ATTRS = [
    'data-component', 'data-source', 'data-file', 'data-testid',
  ];

  async resolve(
    elementData: ElementData,
    workspaceRoot: string,
  ): Promise<SourceLocation | null> {
    const strategies: Array<() => Promise<SourceLocation | null>> = [
      () => this.trySourceMap(elementData, workspaceRoot),
      () => this.tryFrameworkHook(elementData, workspaceRoot),
      () => this.tryDOMAttribute(elementData, workspaceRoot),
      () => this.tryGrepFallback(elementData, workspaceRoot),
    ];

    for (const strategy of strategies) {
      const result = await this.withTimeout(strategy(), SourceMapper.STRATEGY_TIMEOUT_MS);
      if (result) {
        return result;
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Strategy 1 — Source Map
  // ---------------------------------------------------------------------------

  private async trySourceMap(
    elementData: ElementData,
    workspaceRoot: string,
  ): Promise<SourceLocation | null> {
    const info = elementData.componentInfo;
    if (!info?.sourceFile || !info.sourceLine) {
      return null;
    }

    const resolved = this.resolveFilePath(info.sourceFile, workspaceRoot);
    if (!resolved) {
      return null;
    }

    return {
      filePath: path.relative(workspaceRoot, resolved),
      line: info.sourceLine,
      strategy: 'sourcemap',
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy 2 — Framework Hook (filename convention)
  // ---------------------------------------------------------------------------

  private async tryFrameworkHook(
    elementData: ElementData,
    workspaceRoot: string,
  ): Promise<SourceLocation | null> {
    const info = elementData.componentInfo;
    if (!info?.componentName) {
      return null;
    }

    const name = info.componentName;

    for (const ext of SourceMapper.FRAMEWORK_EXTENSIONS) {
      const filename = `${name}${ext}`;
      const found = this.findFileRecursive(workspaceRoot, filename);
      if (found) {
        return {
          filePath: path.relative(workspaceRoot, found),
          line: 1,
          strategy: 'framework',
        };
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Strategy 3 — DOM Attribute
  // ---------------------------------------------------------------------------

  private async tryDOMAttribute(
    elementData: ElementData,
    workspaceRoot: string,
  ): Promise<SourceLocation | null> {
    const attrs = elementData.attrs;
    if (!attrs) {
      return null;
    }

    for (const attr of SourceMapper.SOURCE_ATTRS) {
      const value = attrs[attr];
      if (!value) {
        continue;
      }

      // The attribute value might be a file path (possibly with :line suffix)
      const { filePart, linePart } = this.parseFileHint(value);

      const resolved = this.resolveFilePath(filePart, workspaceRoot);
      if (resolved) {
        return {
          filePath: path.relative(workspaceRoot, resolved),
          line: linePart ?? 1,
          strategy: 'attribute',
        };
      }

      // Try as a component name — search by filename convention
      for (const ext of SourceMapper.FRAMEWORK_EXTENSIONS) {
        const filename = `${filePart}${ext}`;
        const found = this.findFileRecursive(workspaceRoot, filename);
        if (found) {
          return {
            filePath: path.relative(workspaceRoot, found),
            line: linePart ?? 1,
            strategy: 'attribute',
          };
        }
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Strategy 4 — Grep Fallback
  // ---------------------------------------------------------------------------

  private async tryGrepFallback(
    elementData: ElementData,
    workspaceRoot: string,
  ): Promise<SourceLocation | null> {
    const searchTerms = this.buildSearchTerms(elementData);

    for (const term of searchTerms) {
      const result = this.grepForTerm(term, workspaceRoot);
      if (result) {
        return result;
      }
    }

    return null;
  }

  private buildSearchTerms(elementData: ElementData): string[] {
    const terms: string[] = [];

    // Search by id
    if (elementData.id) {
      terms.push(elementData.id);
    }

    // Search by class names — pick the most specific one
    if (elementData.classNames && elementData.classNames.length > 0) {
      const specific = elementData.classNames.find(
        (c) =>
          c.length > 6 &&
          !c.match(
            /^(flex|grid|p-|m-|w-|h-|text-|bg-|border|rounded|gap|items|justify|min-|max-|overflow|relative|absolute|hidden|block|inline)/,
          ),
      );
      if (specific) {
        terms.push(specific);
      } else if (elementData.classNames[0]) {
        terms.push(elementData.classNames[0]);
      }
    }

    // Search by text content
    if (elementData.text && elementData.text.length > 3 && elementData.text.length < 50) {
      terms.push(elementData.text);
    }

    return terms;
  }

  private grepForTerm(
    term: string,
    workspaceRoot: string,
  ): SourceLocation | null {
    try {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const includes = SourceMapper.GREP_INCLUDE.map((p) => `--include='${p}'`).join(' ');
      const excludes = SourceMapper.GREP_EXCLUDE_DIRS.map((d) => `--exclude-dir=${d}`).join(' ');

      const cmd = `grep -rn ${includes} ${excludes} -m 5 ${JSON.stringify(escaped)} .`;

      const out = execSync(cmd, {
        cwd: workspaceRoot,
        encoding: 'utf-8',
        timeout: SourceMapper.STRATEGY_TIMEOUT_MS,
      }).trim();

      const matches = out.split('\n').filter(Boolean);
      if (matches.length > 0 && matches.length <= 10) {
        const m = matches[0].match(/^\.\/(.+?):(\d+):/);
        if (m) {
          return {
            filePath: m[1],
            line: parseInt(m[2], 10),
            strategy: 'grep',
          };
        }
      }
    } catch {
      // grep returns non-zero when no matches found, or on timeout
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Wraps a promise with a timeout. Returns null if the timeout fires first.
   */
  private withTimeout<T>(
    promise: Promise<T | null>,
    ms: number,
  ): Promise<T | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(() => {
          clearTimeout(timer);
          resolve(null);
        });
    });
  }

  /**
   * Resolves a file path hint to an absolute path if the file exists.
   * Tries the path as-is (absolute or relative to workspace root).
   */
  private resolveFilePath(
    filePath: string,
    workspaceRoot: string,
  ): string | null {
    // Try as absolute path
    if (path.isAbsolute(filePath) && fs.existsSync(filePath)) {
      // Only accept if it's within the workspace
      if (filePath.startsWith(workspaceRoot)) {
        return filePath;
      }
    }

    // Try relative to workspace root
    const resolved = path.resolve(workspaceRoot, filePath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }

    return null;
  }

  /**
   * Parses a file hint that may contain a `:line` suffix.
   * e.g. "src/App.tsx:42" → { filePart: "src/App.tsx", linePart: 42 }
   */
  private parseFileHint(value: string): { filePart: string; linePart: number | null } {
    const match = value.match(/^(.+):(\d+)$/);
    if (match) {
      return { filePart: match[1], linePart: parseInt(match[2], 10) };
    }
    return { filePart: value, linePart: null };
  }

  /**
   * Simple recursive file search by exact filename.
   * Skips node_modules, .git, dist, build directories.
   */
  private findFileRecursive(dir: string, filename: string): string | null {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (SourceMapper.GREP_EXCLUDE_DIRS.includes(entry.name)) {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === filename) {
          return fullPath;
        }
        if (entry.isDirectory()) {
          const found = this.findFileRecursive(fullPath, filename);
          if (found) {
            return found;
          }
        }
      }
    } catch {
      // Permission errors, etc.
    }
    return null;
  }
}
