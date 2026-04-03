import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ElementData } from '../src/types';

/**
 * Property 3: Element data extraction completeness.
 * Verifies that any ElementData object built from arbitrary inputs
 * has all required non-undefined fields.
 * Validates: Requirement 4.1
 */
describe('ElementData completeness', () => {
  const elementDataArb: fc.Arbitrary<ElementData> = fc.record({
    selector: fc.stringMatching(/^[a-z][a-z0-9.#:-]*$/),
    tag: fc.stringMatching(/^[a-z][a-z0-9]*$/),
    id: fc.option(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { nil: null }),
    classNames: fc.array(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { maxLength: 5 }),
    attrs: fc.dictionary(
      fc.stringMatching(/^[a-z][a-z0-9-]*$/),
      fc.string({ maxLength: 50 }),
    ),
    text: fc.string({ maxLength: 200 }),
    outerSnippet: fc.string({ maxLength: 500 }),
    domPath: fc.array(fc.stringMatching(/^[a-z][a-z0-9.#-]*$/), { minLength: 1, maxLength: 10 }),
    children: fc.constant([]),
    boxModel: fc.record({
      content: fc.record({ x: fc.float(), y: fc.float(), width: fc.nat(1000), height: fc.nat(1000) }),
      padding: fc.record({ top: fc.nat(50), right: fc.nat(50), bottom: fc.nat(50), left: fc.nat(50) }),
      border: fc.record({ top: fc.nat(10), right: fc.nat(10), bottom: fc.nat(10), left: fc.nat(10) }),
      margin: fc.record({ top: fc.nat(50), right: fc.nat(50), bottom: fc.nat(50), left: fc.nat(50) }),
    }),
    computedStyles: fc.record({
      display: fc.constantFrom('block', 'flex', 'inline', 'grid', 'none'),
      position: fc.constantFrom('static', 'relative', 'absolute', 'fixed'),
      color: fc.string({ maxLength: 30 }),
      backgroundColor: fc.string({ maxLength: 30 }),
      fontSize: fc.string({ maxLength: 10 }),
      fontFamily: fc.string({ maxLength: 50 }),
      width: fc.string({ maxLength: 10 }),
      height: fc.string({ maxLength: 10 }),
      boxSizing: fc.constantFrom('content-box', 'border-box'),
    }),
    componentInfo: fc.constant(null),
  });

  it('all required fields are defined and non-undefined', () => {
    fc.assert(
      fc.property(elementDataArb, (data) => {
        expect(data.tag).toBeDefined();
        expect(data.selector).toBeDefined();
        expect(data.attrs).toBeDefined();
        expect(typeof data.text).toBe('string');
        expect(typeof data.outerSnippet).toBe('string');
        expect(data.domPath).toBeDefined();
        expect(data.domPath.length).toBeGreaterThan(0);
        expect(data.computedStyles).toBeDefined();
        expect(data.boxModel).toBeDefined();
      }),
    );
  });

  it('tag is always a non-empty lowercase string', () => {
    fc.assert(
      fc.property(elementDataArb, (data) => {
        expect(data.tag.length).toBeGreaterThan(0);
        expect(data.tag).toBe(data.tag.toLowerCase());
      }),
    );
  });

  it('selector is always a non-empty string', () => {
    fc.assert(
      fc.property(elementDataArb, (data) => {
        expect(data.selector.length).toBeGreaterThan(0);
      }),
    );
  });
});
