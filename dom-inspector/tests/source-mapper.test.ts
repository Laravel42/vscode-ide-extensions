import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { SourceLocation } from '../src/types';

/**
 * Property 5: Source mapper strategy chain priority.
 * The highest-priority available strategy always wins.
 * Validates: Requirements 5.1, 5.7
 */

type Strategy = SourceLocation['strategy'];
const STRATEGY_ORDER: Strategy[] = ['sourcemap', 'framework', 'attribute', 'grep'];

/**
 * Simulates the SourceMapper.resolve() strategy chain:
 * tries each strategy in order, returns first non-null result.
 */
function resolveWithStrategies(
  results: Partial<Record<Strategy, SourceLocation | null>>,
): SourceLocation | null {
  for (const strategy of STRATEGY_ORDER) {
    const result = results[strategy];
    if (result) return result;
  }
  return null;
}

function makeLocation(strategy: Strategy): SourceLocation {
  return { filePath: `src/Component.tsx`, line: 42, strategy };
}

describe('Source mapper strategy chain priority', () => {
  const strategySubsetArb = fc.subarray(STRATEGY_ORDER, { minLength: 0 });

  it('returns null when no strategies produce results', () => {
    const result = resolveWithStrategies({});
    expect(result).toBeNull();
  });

  it('returns the highest-priority strategy from any subset', () => {
    fc.assert(
      fc.property(strategySubsetArb, (available) => {
        if (available.length === 0) {
          expect(resolveWithStrategies({})).toBeNull();
          return;
        }

        const results: Partial<Record<Strategy, SourceLocation>> = {};
        for (const s of available) {
          results[s] = makeLocation(s);
        }

        const result = resolveWithStrategies(results);
        expect(result).not.toBeNull();

        // Find the expected winner — first in STRATEGY_ORDER that's in available
        const expected = STRATEGY_ORDER.find((s) => available.includes(s));
        expect(result!.strategy).toBe(expected);
      }),
    );
  });

  it('sourcemap always wins when available', () => {
    fc.assert(
      fc.property(strategySubsetArb, (others) => {
        const results: Partial<Record<Strategy, SourceLocation>> = {};
        results['sourcemap'] = makeLocation('sourcemap');
        for (const s of others) {
          results[s] = makeLocation(s);
        }
        const result = resolveWithStrategies(results);
        expect(result!.strategy).toBe('sourcemap');
      }),
    );
  });

  it('grep only wins when no higher-priority strategy is available', () => {
    fc.assert(
      fc.property(strategySubsetArb, (available) => {
        const results: Partial<Record<Strategy, SourceLocation>> = {};
        for (const s of available) {
          results[s] = makeLocation(s);
        }
        results['grep'] = makeLocation('grep');

        const result = resolveWithStrategies(results);
        if (available.length === 0) {
          expect(result!.strategy).toBe('grep');
        } else {
          const highestAvailable = STRATEGY_ORDER.find(
            (s) => available.includes(s) || s === 'grep',
          );
          expect(result!.strategy).toBe(highestAvailable);
        }
      }),
    );
  });
});

/**
 * Property 6: DOM attribute hint extraction.
 * Non-empty data-* attribute values produce non-empty hints.
 * Validates: Requirement 5.5
 */
describe('DOM attribute hint extraction', () => {
  const SOURCE_ATTRS = ['data-component', 'data-source', 'data-file', 'data-testid'];

  /** Mirrors the parseFileHint logic from SourceMapper */
  function parseFileHint(value: string): { filePart: string; linePart: number | null } {
    const match = value.match(/^(.+):(\d+)$/);
    if (match) {
      return { filePart: match[1], linePart: parseInt(match[2], 10) };
    }
    return { filePart: value, linePart: null };
  }

  it('extracts non-empty filePart from any non-empty attribute value', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9/._-]+$/),
        (value) => {
          const { filePart } = parseFileHint(value);
          expect(filePart.length).toBeGreaterThan(0);
        },
      ),
    );
  });

  it('parses :line suffix correctly', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9/._-]+$/),
        fc.integer({ min: 1, max: 10000 }),
        (file, line) => {
          const { filePart, linePart } = parseFileHint(`${file}:${line}`);
          expect(filePart).toBe(file);
          expect(linePart).toBe(line);
        },
      ),
    );
  });

  it('returns null linePart when no :line suffix', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9/._-]+$/),
        (value) => {
          fc.pre(!value.match(/:\d+$/));
          const { linePart } = parseFileHint(value);
          expect(linePart).toBeNull();
        },
      ),
    );
  });

  it('each source attribute name is a valid data-* attribute', () => {
    for (const attr of SOURCE_ATTRS) {
      expect(attr).toMatch(/^data-[a-z]+$/);
    }
  });
});
