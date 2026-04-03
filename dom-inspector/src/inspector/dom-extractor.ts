/**
 * DOMExtractor — Injected page module (runs in browser context).
 *
 * Extracts structured data from DOM elements for the inspector.
 * Provides lightweight hover data, full element data, child summaries,
 * and DOM path computation.
 *
 * This module must NOT import vscode or any Node.js modules.
 * Type-only imports from '../types' are stripped at bundle time.
 */

import type {
  BoxModelData,
  ChildSummary,
  ComputedStyleData,
  ElementData,
  HoverData,
} from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a CSS pixel value (e.g. "12px") to a number, defaulting to 0. */
function parsePx(value: string): number {
  return parseFloat(value) || 0;
}

/** Extract class names from an element as a string array. */
function getClassNames(el: Element): string[] {
  if (el.className && typeof el.className === 'string') {
    return el.className.trim().split(/\s+/).filter(Boolean);
  }
  return [];
}

/** Extract all attributes from an element as a Record. */
function getAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    attrs[attr.name] = attr.value;
  }
  return attrs;
}

// ---------------------------------------------------------------------------
// CSS Selector Generation
// ---------------------------------------------------------------------------

/**
 * Generate a CSS selector for an element.
 * Priority: id → classes → nth-of-type fallback.
 */
export function generateSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();

  // Prefer id — guaranteed unique
  if (el.id) {
    return `${tag}#${el.id}`;
  }

  // Try classes — may not be unique, but usually good enough
  const classes = getClassNames(el);
  if (classes.length > 0) {
    const classSelector = `${tag}.${classes.join('.')}`;
    // Check uniqueness in the document
    try {
      if (document.querySelectorAll(classSelector).length === 1) {
        return classSelector;
      }
    } catch {
      // Invalid selector chars in class names — fall through
    }
  }

  // Fallback: nth-of-type
  const parent = el.parentElement;
  if (!parent) {
    return tag;
  }

  const siblings = parent.children;
  let index = 0;
  let sameTagCount = 0;
  for (let i = 0; i < siblings.length; i++) {
    if (siblings[i].tagName === el.tagName) {
      sameTagCount++;
      if (siblings[i] === el) {
        index = sameTagCount;
      }
    }
  }

  if (sameTagCount === 1) {
    return tag;
  }

  return `${tag}:nth-of-type(${index})`;
}

/**
 * Build a full unique selector path from root to element.
 * Each segment uses the best available selector strategy.
 */
function buildSelectorPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.documentElement) {
    parts.unshift(generateSelector(current));
    current = current.parentElement;
  }

  return parts.join(' > ');
}

// ---------------------------------------------------------------------------
// Box Model Extraction
// ---------------------------------------------------------------------------

function extractBoxModel(el: Element): BoxModelData {
  const rect = el.getBoundingClientRect();
  let cs: CSSStyleDeclaration;
  try {
    cs = getComputedStyle(el);
  } catch {
    return {
      content: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    };
  }

  const padding = {
    top: parsePx(cs.paddingTop),
    right: parsePx(cs.paddingRight),
    bottom: parsePx(cs.paddingBottom),
    left: parsePx(cs.paddingLeft),
  };
  const border = {
    top: parsePx(cs.borderTopWidth),
    right: parsePx(cs.borderRightWidth),
    bottom: parsePx(cs.borderBottomWidth),
    left: parsePx(cs.borderLeftWidth),
  };
  const margin = {
    top: parsePx(cs.marginTop),
    right: parsePx(cs.marginRight),
    bottom: parsePx(cs.marginBottom),
    left: parsePx(cs.marginLeft),
  };

  // getBoundingClientRect returns border-box. Derive content rect.
  const contentRect = {
    x: rect.x + border.left + padding.left,
    y: rect.y + border.top + padding.top,
    width: rect.width - border.left - border.right - padding.left - padding.right,
    height: rect.height - border.top - border.bottom - padding.top - padding.bottom,
  };

  return { content: contentRect, padding, border, margin };
}

// ---------------------------------------------------------------------------
// Computed Styles Extraction
// ---------------------------------------------------------------------------

function extractComputedStyles(el: Element): ComputedStyleData {
  try {
    const cs = getComputedStyle(el);
    return {
      display: cs.display,
      position: cs.position,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily,
      width: cs.width,
      height: cs.height,
      boxSizing: cs.boxSizing,
    };
  } catch {
    return {
      display: '',
      position: '',
      color: '',
      backgroundColor: '',
      fontSize: '',
      fontFamily: '',
      width: '',
      height: '',
      boxSizing: '',
    };
  }
}

// ---------------------------------------------------------------------------
// DOMExtractor class
// ---------------------------------------------------------------------------

export class DOMExtractor {
  /**
   * Lightweight data for hover tooltip display.
   */
  getHoverData(el: Element): HoverData {
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classNames: getClassNames(el),
      width: rect.width,
      height: rect.height,
      boxModel: extractBoxModel(el),
    };
  }

  /**
   * Complete element data for click capture / sidebar display.
   */
  getFullData(el: Element): ElementData {
    const tag = el.tagName.toLowerCase();
    const id = el.id || null;
    const classNames = getClassNames(el);
    const attrs = getAttributes(el);
    const text = (el.textContent || '').slice(0, 200);
    const outerSnippet = el.outerHTML.slice(0, 500);
    const selector = generateSelector(el);
    const domPath = this.getDOMPath(el);
    const children = this.getDirectChildren(el);
    const boxModel = extractBoxModel(el);
    const computedStyles = extractComputedStyles(el);

    return {
      selector,
      tag,
      id,
      classNames,
      attrs,
      text,
      outerSnippet,
      domPath,
      children,
      boxModel,
      computedStyles,
      componentInfo: null, // Populated by FrameworkDetector externally
    };
  }

  /**
   * Lazy-load children for a DOM tree node identified by CSS selector.
   */
  getChildren(selector: string): ChildSummary[] {
    const el = document.querySelector(selector);
    if (!el) {
      return [];
    }
    return this.getDirectChildren(el);
  }

  /**
   * Build the full DOM path from root to element.
   * Each segment is formatted as tag#id.class1.class2.
   */
  getDOMPath(el: Element): string[] {
    const path: string[] = [];
    let current: Element | null = el;

    while (current) {
      const tag = current.tagName.toLowerCase();
      let segment = tag;
      if (current.id) {
        segment += '#' + current.id;
      }
      const classes = getClassNames(current);
      if (classes.length > 0) {
        segment += '.' + classes.join('.');
      }
      path.unshift(segment);
      current = current.parentElement;
    }

    return path;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Build ChildSummary array for direct children of an element. */
  private getDirectChildren(el: Element): ChildSummary[] {
    const children: ChildSummary[] = [];
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i];
      children.push({
        tag: child.tagName.toLowerCase(),
        id: child.id || null,
        classNames: getClassNames(child),
        childCount: child.children.length,
        selectorPath: buildSelectorPath(child),
      });
    }
    return children;
  }
}
