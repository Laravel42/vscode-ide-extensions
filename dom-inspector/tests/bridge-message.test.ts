import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { BridgeMessage } from '../src/types';

/**
 * Property 4: Bridge message serialization round-trip.
 * JSON.parse(JSON.stringify(msg)) deeply equals original for all message types.
 * Validates: Requirements 4.3, 9.5, 10.3, 10.4
 */

const boxModelArb = fc.record({
  content: fc.record({ x: fc.float(), y: fc.float(), width: fc.nat(2000), height: fc.nat(2000) }),
  padding: fc.record({ top: fc.nat(50), right: fc.nat(50), bottom: fc.nat(50), left: fc.nat(50) }),
  border: fc.record({ top: fc.nat(10), right: fc.nat(10), bottom: fc.nat(10), left: fc.nat(10) }),
  margin: fc.record({ top: fc.nat(50), right: fc.nat(50), bottom: fc.nat(50), left: fc.nat(50) }),
});

const hoverDataArb = fc.record({
  tag: fc.stringMatching(/^[a-z][a-z0-9]*$/),
  id: fc.option(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { nil: null }),
  classNames: fc.array(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { maxLength: 3 }),
  width: fc.nat(2000),
  height: fc.nat(2000),
  boxModel: boxModelArb,
});

const childSummaryArb = fc.record({
  tag: fc.stringMatching(/^[a-z][a-z0-9]*$/),
  id: fc.option(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { nil: null }),
  classNames: fc.array(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { maxLength: 3 }),
  childCount: fc.nat(100),
  selectorPath: fc.string({ maxLength: 100 }),
});

const elementDataArb = fc.record({
  selector: fc.string({ maxLength: 50 }),
  tag: fc.stringMatching(/^[a-z][a-z0-9]*$/),
  id: fc.option(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { nil: null }),
  classNames: fc.array(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { maxLength: 3 }),
  attrs: fc.dictionary(fc.stringMatching(/^[a-z][a-z0-9-]*$/), fc.string({ maxLength: 20 })),
  text: fc.string({ maxLength: 200 }),
  outerSnippet: fc.string({ maxLength: 200 }),
  domPath: fc.array(fc.string({ maxLength: 30 }), { minLength: 1, maxLength: 5 }),
  children: fc.array(childSummaryArb, { maxLength: 3 }),
  boxModel: boxModelArb,
  computedStyles: fc.record({
    display: fc.constantFrom('block', 'flex', 'inline'),
    position: fc.constantFrom('static', 'relative', 'absolute'),
    color: fc.string({ maxLength: 20 }),
    backgroundColor: fc.string({ maxLength: 20 }),
    fontSize: fc.string({ maxLength: 10 }),
    fontFamily: fc.string({ maxLength: 30 }),
    width: fc.string({ maxLength: 10 }),
    height: fc.string({ maxLength: 10 }),
    boxSizing: fc.constantFrom('content-box', 'border-box'),
  }),
  componentInfo: fc.constant(null),
});

const selectorArb = fc.stringMatching(/^[a-z][a-z0-9.#> -]*$/);

const bridgeMessageArb: fc.Arbitrary<BridgeMessage> = fc.oneof(
  fc.constant({ type: 'start_inspector' as const }),
  fc.constant({ type: 'stop_inspector' as const }),
  hoverDataArb.map((data) => ({ type: 'element_hovered' as const, data })),
  elementDataArb.map((data) => ({ type: 'element_picked' as const, data })),
  fc.constant({ type: 'element_pick_cancelled' as const }),
  selectorArb.map((selector) => ({ type: 'highlight_element' as const, selector })),
  selectorArb.map((selector) => ({ type: 'scroll_to_element' as const, selector })),
  selectorArb.map((selector) => ({ type: 'get_children' as const, selector })),
  fc.record({
    selector: selectorArb,
    children: fc.array(childSummaryArb, { maxLength: 3 }),
  }).map(({ selector, children }) => ({ type: 'children_response' as const, selector, children })),
  fc.constantFrom('react' as const, 'vue' as const, 'angular' as const, 'svelte' as const).map(
    (framework) => ({ type: 'framework_detected' as const, framework }),
  ),
  fc.constant({ type: 'inspector_ready' as const }),
  fc.constant({ type: 'connection_lost' as const }),
  fc.constant({ type: 'connection_restored' as const }),
);

describe('BridgeMessage serialization round-trip', () => {
  it('JSON round-trip preserves all message data', () => {
    fc.assert(
      fc.property(bridgeMessageArb, (msg) => {
        const roundTripped = JSON.parse(JSON.stringify(msg));
        expect(roundTripped).toEqual(msg);
      }),
    );
  });

  it('type field is always preserved', () => {
    fc.assert(
      fc.property(bridgeMessageArb, (msg) => {
        const roundTripped = JSON.parse(JSON.stringify(msg));
        expect(roundTripped.type).toBe(msg.type);
      }),
    );
  });
});
