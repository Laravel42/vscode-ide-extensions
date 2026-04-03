import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ElementData, SourceLocation } from './types';

/**
 * Language identifier mapping from file extension to fenced code block language.
 */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.tsx': 'tsx',
  '.jsx': 'jsx',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.html': 'html',
};

/**
 * Builds rich Markdown context from a picked DOM element and its resolved
 * source location, then inserts it into the Kiro chat prompt.
 *
 * Extracted from the inline logic in `extension.ts` and enhanced with
 * component hierarchy and box model information.
 */
export class ChatContextBuilder {
  /**
   * Produce a Markdown string with element details as a bulleted list
   * and source code in a fenced code block with language identifier.
   */
  build(
    element: ElementData,
    source: SourceLocation | null,
    snippet: string,
  ): string {
    const lines: string[] = [];

    // --- Element details ---
    lines.push('## Picked DOM Element');
    lines.push(`- Tag: \`<${element.tag}>\``);
    lines.push(`- Selector: \`${element.selector}\``);

    if (element.id) {
      lines.push(`- ID: \`${element.id}\``);
    }

    if (element.classNames && element.classNames.length > 0) {
      lines.push(`- Classes: \`${element.classNames.join(' ')}\``);
    }

    if (element.text) {
      lines.push(`- Text: "${element.text.slice(0, 100)}"`);
    }

    if (element.outerSnippet) {
      lines.push(`- HTML: \`${element.outerSnippet.slice(0, 300)}\``);
    }

    // Component hierarchy (when available)
    if (element.componentInfo) {
      const info = element.componentInfo;
      if (info.componentPath && info.componentPath.length > 0) {
        lines.push(`- Component: \`${info.componentPath.join(' > ')}\``);
      } else if (info.componentName) {
        lines.push(`- Component: \`${info.componentName}\``);
      }
      if (info.framework) {
        lines.push(`- Framework: ${info.framework}`);
      }
    }

    // Box model info
    const bm = element.boxModel;
    if (bm) {
      const { width, height } = bm.content;
      const pad = bm.padding;
      const mar = bm.margin;
      lines.push(
        `- Box Model: ${width}×${height} | padding: ${pad.top} ${pad.right} ${pad.bottom} ${pad.left} | margin: ${mar.top} ${mar.right} ${mar.bottom} ${mar.left}`,
      );
    }

    // --- Source code section ---
    if (source && snippet) {
      lines.push('');
      lines.push(`## Source: \`${source.filePath}\` (line ${source.line})`);

      const lang = this.getLanguageId(source.filePath);
      lines.push(`\`\`\`${lang}`);
      lines.push(snippet);
      lines.push('```');
    }

    return lines.join('\n');
  }

  /**
   * Insert the context message into the Kiro chat. Falls back to clipboard
   * copy with a notification if the chat command is unavailable.
   */
  async insertIntoChat(contextMsg: string): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: contextMsg,
      });
    } catch {
      await vscode.env.clipboard.writeText(contextMsg);
      vscode.window.showInformationMessage(
        'Element context copied to clipboard — paste it into the chat.',
      );
    }
  }

  /**
   * Read a source file and extract ±10 lines around `line`, with the matched
   * line visually marked using a `→` prefix.
   *
   * @param filePath Absolute path to the source file.
   * @param line     1-based line number to centre the snippet on.
   * @returns The formatted snippet string, or an empty string on failure.
   */
  extractSnippet(filePath: string, line: number): string {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const allLines = content.split('\n');
      const start = Math.max(0, line - 11);
      const end = Math.min(allLines.length, line + 10);

      return allLines
        .slice(start, end)
        .map((l, i) => {
          const num = start + i + 1;
          const marker = num === line ? '→' : ' ';
          return `${marker} ${num}: ${l}`;
        })
        .join('\n');
    } catch {
      return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Derive a fenced-code-block language identifier from a file path's extension.
   */
  private getLanguageId(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_TO_LANGUAGE[ext] ?? 'html';
  }
}
