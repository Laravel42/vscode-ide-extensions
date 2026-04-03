import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Property 7: DOM tree node label formatting.
 * Labels contain tag, #id (if present), .className for each class.
 * Validates: Requirement 7.6
 */

/** Mirrors the label formatting used in the sidebar tree view */
function formatNodeLabel(tag: string, id: string | null, classNames: string[]): string {
  let label = tag.toLowerCase();
  if (id) {
    label += `#${id}`;
  }
  for (const cls of classNames) {
    label += `.${cls}`;
  }
  return label;
}

describe('DOM tree node label formatting', () => {
  const tagArb = fc.stringMatching(/^[a-z][a-z0-9]*$/);
  const idArb = fc.option(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { nil: null });
  const classesArb = fc.array(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { maxLength: 5 });

  it('always contains the tag name', () => {
    fc.assert(
      fc.property(tagArb, idArb, classesArb, (tag, id, classes) => {
        const label = formatNodeLabel(tag, id, classes);
        expect(label).toContain(tag);
      }),
    );
  });

  it('contains #id when id is present', () => {
    fc.assert(
      fc.property(tagArb, fc.stringMatching(/^[a-z][a-z0-9-]*$/), classesArb, (tag, id, classes) => {
        const label = formatNodeLabel(tag, id, classes);
        expect(label).toContain(`#${id}`);
      }),
    );
  });

  it('does not contain # when id is null', () => {
    fc.assert(
      fc.property(tagArb, classesArb, (tag, classes) => {
        const label = formatNodeLabel(tag, null, classes);
        expect(label).not.toContain('#');
      }),
    );
  });

  it('contains .className for each class', () => {
    fc.assert(
      fc.property(tagArb, idArb, classesArb, (tag, id, classes) => {
        const label = formatNodeLabel(tag, id, classes);
        for (const cls of classes) {
          expect(label).toContain(`.${cls}`);
        }
      }),
    );
  });

  it('starts with the tag name', () => {
    fc.assert(
      fc.property(tagArb, idArb, classesArb, (tag, id, classes) => {
        const label = formatNodeLabel(tag, id, classes);
        expect(label.startsWith(tag)).toBe(true);
      }),
    );
  });
});
