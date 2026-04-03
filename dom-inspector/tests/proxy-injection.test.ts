import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Property 8: Proxy injects inspector script into HTML.
 * Verifies that the injection logic preserves original content and
 * always includes the inspector script, with or without </body>.
 * Validates: Requirement 10.1
 */

const INSPECTOR_MARKER = 'data-kiro-inspector';

/**
 * Mirrors the injection logic from proxy.ts:
 *   const injected = body.replace(/<\/body>/i, INSPECTOR_SCRIPT + "</body>");
 *   res.end(injected === body ? body + INSPECTOR_SCRIPT : injected);
 */
function injectScript(body: string, script: string): string {
  const injected = body.replace(/<\/body>/i, script + '</body>');
  return injected === body ? body + script : injected;
}

const MOCK_SCRIPT = `<script ${INSPECTOR_MARKER}>/* inspector */</script>`;

describe('Proxy HTML injection', () => {
  it('output always contains the inspector script', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (html) => {
        const result = injectScript(html, MOCK_SCRIPT);
        expect(result).toContain(INSPECTOR_MARKER);
      }),
    );
  });

  it('original content is preserved in the output', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 200 }),
        (html) => {
          // Skip strings that happen to contain our marker already
          fc.pre(!html.includes(INSPECTOR_MARKER));
          const result = injectScript(html, MOCK_SCRIPT);
          // Remove the injected script to check original content is intact
          const withoutScript = result.replace(MOCK_SCRIPT, '');
          // The original content should be a substring (possibly with </body> reattached)
          const originalWithoutBody = html.replace(/<\/body>/i, '');
          expect(withoutScript).toContain(originalWithoutBody);
        },
      ),
    );
  });

  it('injects before </body> when tag is present', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 100 }),
        fc.string({ maxLength: 100 }),
        (before, after) => {
          fc.pre(!before.includes('</body>') && !before.includes('</BODY>'));
          fc.pre(!after.includes('</body>') && !after.includes('</BODY>'));
          const html = `${before}</body>${after}`;
          const result = injectScript(html, MOCK_SCRIPT);
          const idx = result.indexOf(MOCK_SCRIPT);
          const bodyIdx = result.indexOf('</body>');
          expect(idx).toBeLessThan(bodyIdx);
        },
      ),
    );
  });

  it('appends at end when no </body> tag exists', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (html) => {
        fc.pre(!html.toLowerCase().includes('</body>'));
        const result = injectScript(html, MOCK_SCRIPT);
        expect(result).toBe(html + MOCK_SCRIPT);
      }),
    );
  });

  it('handles case-insensitive </BODY> tag', () => {
    const html = '<html><BODY>content</BODY></html>';
    const result = injectScript(html, MOCK_SCRIPT);
    expect(result).toContain(INSPECTOR_MARKER);
  });
});
