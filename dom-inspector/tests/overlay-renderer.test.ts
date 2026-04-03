import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildTooltipLabel, computeBoxModelRects } from '../src/inspector/overlay-renderer';

/**
 * Property 1: Tooltip label contains all element identifiers and dimensions.
 * Validates: Requirement 2.3
 */
describe('buildTooltipLabel', () => {
  it('always contains the tag name (lowercased)', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9]*$/),
        fc.array(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { minLength: 0, maxLength: 5 }),
        fc.option(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { nil: null }),
        fc.nat(2000),
        fc.nat(2000),
        (tag, classes, id, w, h) => {
          const label = buildTooltipLabel(tag, classes, id, w, h);
          expect(label).toContain(tag);
        },
      ),
    );
  });

  it('contains every class name when classes are present', () => {
    fc.assert(
      fc.property(
        fc.constant('div'),
        fc.array(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { minLength: 1, maxLength: 5 }),
        fc.constant(null),
        fc.nat(2000),
        fc.nat(2000),
        (tag, classes, id, w, h) => {
          const label = buildTooltipLabel(tag, classes, id, w, h);
          for (const cls of classes) {
            expect(label).toContain(cls);
          }
        },
      ),
    );
  });

  it('contains the id when present', () => {
    fc.assert(
      fc.property(
        fc.constant('div'),
        fc.constant([]),
        fc.stringMatching(/^[a-z][a-z0-9-]*$/),
        fc.nat(2000),
        fc.nat(2000),
        (tag, classes, id, w, h) => {
          const label = buildTooltipLabel(tag, classes, id, w, h);
          expect(label).toContain('#' + id);
        },
      ),
    );
  });

  it('contains width × height dimensions', () => {
    fc.assert(
      fc.property(
        fc.constant('div'),
        fc.constant([]),
        fc.constant(null),
        fc.nat(2000),
        fc.nat(2000),
        (tag, classes, id, w, h) => {
          const label = buildTooltipLabel(tag, classes, id, w, h);
          expect(label).toContain(`${Math.round(w)} × ${Math.round(h)}`);
        },
      ),
    );
  });
});

/**
 * Property 2: Box model layer geometric containment.
 * padding ⊇ content, border ⊇ padding, margin ⊇ border.
 * Validates: Requirement 3.5
 */
describe('computeBoxModelRects', () => {
  const nonNegSides = () =>
    fc.record({
      top: fc.nat(100),
      right: fc.nat(100),
      bottom: fc.nat(100),
      left: fc.nat(100),
    });

  const contentRect = () =>
    fc.record({
      x: fc.integer({ min: -500, max: 500 }),
      y: fc.integer({ min: -500, max: 500 }),
      width: fc.nat(1000),
      height: fc.nat(1000),
    });

  function contains(
    outer: { x: number; y: number; width: number; height: number },
    inner: { x: number; y: number; width: number; height: number },
  ) {
    // outer left edge <= inner left edge
    expect(outer.x).toBeLessThanOrEqual(inner.x + 1e-9);
    // outer top edge <= inner top edge
    expect(outer.y).toBeLessThanOrEqual(inner.y + 1e-9);
    // outer right edge >= inner right edge
    expect(outer.x + outer.width).toBeGreaterThanOrEqual(inner.x + inner.width - 1e-9);
    // outer bottom edge >= inner bottom edge
    expect(outer.y + outer.height).toBeGreaterThanOrEqual(inner.y + inner.height - 1e-9);
  }

  it('padding layer contains content layer', () => {
    fc.assert(
      fc.property(contentRect(), nonNegSides(), nonNegSides(), nonNegSides(), (cr, pad, bdr, mar) => {
        const rects = computeBoxModelRects(cr, pad, bdr, mar);
        contains(rects.padding, rects.content);
      }),
    );
  });

  it('border layer contains padding layer', () => {
    fc.assert(
      fc.property(contentRect(), nonNegSides(), nonNegSides(), nonNegSides(), (cr, pad, bdr, mar) => {
        const rects = computeBoxModelRects(cr, pad, bdr, mar);
        contains(rects.border, rects.padding);
      }),
    );
  });

  it('margin layer contains border layer', () => {
    fc.assert(
      fc.property(contentRect(), nonNegSides(), nonNegSides(), nonNegSides(), (cr, pad, bdr, mar) => {
        const rects = computeBoxModelRects(cr, pad, bdr, mar);
        contains(rects.margin, rects.border);
      }),
    );
  });
});
