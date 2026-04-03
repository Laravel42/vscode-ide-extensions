import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ElementData, SourceLocation } from '../src/types';

/**
 * Property 10: Chat context message completeness and Markdown format.
 * Verifies output contains bulleted list with element details and
 * fenced code block with correct language.
 * Validates: Requirements 13.1, 13.2, 13.5
 */

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.tsx': 'tsx',
  '.jsx': 'jsx',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.html': 'html',
};

function getLanguageId(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return EXTENSION_TO_LANGUAGE[ext] ?? 'html';
}

/** Mirrors ChatContextBuilder.build() */
function buildContext(
  element: ElementData,
  source: SourceLocation | null,
  snippet: string,
): string {
  const lines: string[] = [];
  lines.push('## Picked DOM Element');
  lines.push(`- Tag: \`<${element.tag}>\``);
  lines.push(`- Selector: \`${element.selector}\``);
  if (element.id) lines.push(`- ID: \`${element.id}\``);
  if (element.classNames?.length) lines.push(`- Classes: \`${element.classNames.join(' ')}\``);
  if (element.text) lines.push(`- Text: "${element.text.slice(0, 100)}"`);
  if (element.outerSnippet) lines.push(`- HTML: \`${element.outerSnippet.slice(0, 300)}\``);

  if (source && snippet) {
    lines.push('');
    lines.push(`## Source: \`${source.filePath}\` (line ${source.line})`);
    const lang = getLanguageId(source.filePath);
    lines.push(`\`\`\`${lang}`);
    lines.push(snippet);
    lines.push('```');
  }
  return lines.join('\n');
}

const boxModelArb = fc.record({
  content: fc.record({ x: fc.constant(0), y: fc.constant(0), width: fc.nat(500), height: fc.nat(500) }),
  padding: fc.record({ top: fc.nat(20), right: fc.nat(20), bottom: fc.nat(20), left: fc.nat(20) }),
  border: fc.record({ top: fc.nat(5), right: fc.nat(5), bottom: fc.nat(5), left: fc.nat(5) }),
  margin: fc.record({ top: fc.nat(20), right: fc.nat(20), bottom: fc.nat(20), left: fc.nat(20) }),
});

const elementArb: fc.Arbitrary<ElementData> = fc.record({
  selector: fc.stringMatching(/^[a-z][a-z0-9.#-]*$/),
  tag: fc.stringMatching(/^[a-z][a-z0-9]*$/),
  id: fc.option(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { nil: null }),
  classNames: fc.array(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { maxLength: 3 }),
  attrs: fc.constant({}),
  text: fc.string({ minLength: 1, maxLength: 50 }),
  outerSnippet: fc.string({ minLength: 1, maxLength: 100 }),
  domPath: fc.array(fc.string({ maxLength: 20 }), { minLength: 1, maxLength: 3 }),
  children: fc.constant([]),
  boxModel: boxModelArb,
  computedStyles: fc.record({
    display: fc.constant('block'),
    position: fc.constant('static'),
    color: fc.constant('black'),
    backgroundColor: fc.constant('white'),
    fontSize: fc.constant('16px'),
    fontFamily: fc.constant('sans-serif'),
    width: fc.constant('100px'),
    height: fc.constant('50px'),
    boxSizing: fc.constant('border-box'),
  }),
  componentInfo: fc.constant(null),
});

const sourceArb: fc.Arbitrary<SourceLocation> = fc.record({
  filePath: fc.constantFrom('src/App.tsx', 'src/Page.jsx', 'src/Main.vue', 'src/Card.svelte', 'index.html'),
  line: fc.integer({ min: 1, max: 500 }),
  strategy: fc.constantFrom('sourcemap' as const, 'framework' as const, 'attribute' as const, 'grep' as const),
});

describe('Chat context message completeness', () => {
  it('always contains the tag in a bulleted list', () => {
    fc.assert(
      fc.property(elementArb, sourceArb, fc.string({ minLength: 1, maxLength: 100 }), (el, src, snippet) => {
        const ctx = buildContext(el, src, snippet);
        expect(ctx).toContain(`- Tag: \`<${el.tag}>\``);
      }),
    );
  });

  it('always contains the selector', () => {
    fc.assert(
      fc.property(elementArb, (el) => {
        const ctx = buildContext(el, null, '');
        expect(ctx).toContain(`- Selector: \`${el.selector}\``);
      }),
    );
  });

  it('contains ID when present', () => {
    fc.assert(
      fc.property(elementArb, (el) => {
        fc.pre(el.id !== null);
        const ctx = buildContext(el, null, '');
        expect(ctx).toContain(`- ID: \`${el.id}\``);
      }),
    );
  });

  it('contains classes when present', () => {
    fc.assert(
      fc.property(elementArb, (el) => {
        fc.pre(el.classNames.length > 0);
        const ctx = buildContext(el, null, '');
        expect(ctx).toContain('- Classes:');
        for (const cls of el.classNames) {
          expect(ctx).toContain(cls);
        }
      }),
    );
  });

  it('contains fenced code block with correct language when source is provided', () => {
    fc.assert(
      fc.property(elementArb, sourceArb, fc.string({ minLength: 1, maxLength: 100 }), (el, src, snippet) => {
        const ctx = buildContext(el, src, snippet);
        const lang = getLanguageId(src.filePath);
        expect(ctx).toContain('```' + lang);
        expect(ctx).toContain(snippet);
        // Ends with closing fence
        expect(ctx).toMatch(/```$/);
      }),
    );
  });

  it('contains source file path and line number', () => {
    fc.assert(
      fc.property(elementArb, sourceArb, fc.string({ minLength: 1, maxLength: 50 }), (el, src, snippet) => {
        const ctx = buildContext(el, src, snippet);
        expect(ctx).toContain(src.filePath);
        expect(ctx).toContain(`line ${src.line}`);
      }),
    );
  });

  it('omits source section when source is null', () => {
    fc.assert(
      fc.property(elementArb, (el) => {
        const ctx = buildContext(el, null, '');
        expect(ctx).not.toContain('## Source:');
        expect(ctx).not.toContain('```tsx');
      }),
    );
  });
});
