/**
 * OverlayRenderer — Injected page module (runs in browser context).
 *
 * Renders Chrome DevTools-style box model overlays (content, padding, border,
 * margin) plus a tooltip label on top of the inspected page.
 *
 * This module must NOT import vscode or any Node.js modules.
 * Type-only imports from '../types' are stripped at bundle time.
 */

import type { BoxModelData } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLORS = {
  content: 'rgba(66, 153, 225, 0.20)',
  padding: 'rgba(72, 199, 142, 0.20)',
  border: 'rgba(66, 153, 225, 0.15)',
  margin: 'rgba(239, 68, 68, 0.20)',
} as const;

const OVERLAY_Z_INDEX = '2147483646';

const BASE_STYLES: Record<string, string> = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: OVERLAY_Z_INDEX,
  display: 'none',
  boxSizing: 'border-box',
};

const TOOLTIP_STYLES: Record<string, string> = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: '2147483647',
  display: 'none',
  background: '#0d1117',
  color: '#e6edf3',
  font: '11px/1.4 monospace',
  padding: '2px 6px',
  borderRadius: '3px',
  border: '1px solid #30363d',
  maxWidth: '400px',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a CSS pixel value (e.g. "12px") to a number, defaulting to 0. */
function parsePx(value: string): number {
  return parseFloat(value) || 0;
}

/**
 * Build the tooltip label string for an element.
 * Format: tag.class1.class2#id (width × height)
 */
export function buildTooltipLabel(
  tag: string,
  classNames: string[],
  id: string | null,
  width: number,
  height: number,
): string {
  let label = tag.toLowerCase();
  if (classNames.length > 0) {
    label += '.' + classNames.join('.');
  }
  if (id) {
    label += '#' + id;
  }
  label += ` (${Math.round(width)} × ${Math.round(height)})`;
  return label;
}

/**
 * Compute the four box-model layer rects from a content DOMRect and
 * computed style values. Returns rects for content, padding, border, margin
 * layers as {x, y, width, height} objects.
 */
export function computeBoxModelRects(
  contentRect: { x: number; y: number; width: number; height: number },
  padding: { top: number; right: number; bottom: number; left: number },
  border: { top: number; right: number; bottom: number; left: number },
  margin: { top: number; right: number; bottom: number; left: number },
) {
  // Padding layer wraps content
  const paddingRect = {
    x: contentRect.x - padding.left,
    y: contentRect.y - padding.top,
    width: contentRect.width + padding.left + padding.right,
    height: contentRect.height + padding.top + padding.bottom,
  };

  // Border layer wraps padding
  const borderRect = {
    x: paddingRect.x - border.left,
    y: paddingRect.y - border.top,
    width: paddingRect.width + border.left + border.right,
    height: paddingRect.height + border.top + border.bottom,
  };

  // Margin layer wraps border
  const marginRect = {
    x: borderRect.x - margin.left,
    y: borderRect.y - margin.top,
    width: borderRect.width + margin.left + margin.right,
    height: borderRect.height + margin.top + margin.bottom,
  };

  return { content: contentRect, padding: paddingRect, border: borderRect, margin: marginRect };
}

// ---------------------------------------------------------------------------
// OverlayRenderer class
// ---------------------------------------------------------------------------

export class OverlayRenderer {
  private contentDiv: HTMLDivElement | null = null;
  private paddingDiv: HTMLDivElement | null = null;
  private borderDiv: HTMLDivElement | null = null;
  private marginDiv: HTMLDivElement | null = null;
  private tooltipDiv: HTMLDivElement | null = null;
  private initialized = false;

  /** Create overlay DOM elements and append to document.documentElement. */
  init(): void {
    if (this.initialized) {
      return;
    }

    this.marginDiv = this.createOverlayDiv(COLORS.margin);
    this.borderDiv = this.createOverlayDiv(COLORS.border);
    this.paddingDiv = this.createOverlayDiv(COLORS.padding);
    this.contentDiv = this.createOverlayDiv(COLORS.content);
    this.tooltipDiv = this.createTooltipDiv();

    document.documentElement.appendChild(this.marginDiv);
    document.documentElement.appendChild(this.borderDiv);
    document.documentElement.appendChild(this.paddingDiv);
    document.documentElement.appendChild(this.contentDiv);
    document.documentElement.appendChild(this.tooltipDiv);

    this.initialized = true;
  }

  /**
   * Draw box model overlays for the given element.
   * Batches all DOM reads before DOM writes to avoid layout thrashing.
   */
  draw(el: Element): void {
    this.ensureInitialized();

    // --- DOM READS (batched) ---
    const rect = el.getBoundingClientRect();
    let cs: CSSStyleDeclaration;
    try {
      cs = getComputedStyle(el);
    } catch {
      // Detached node or similar — fall back to zero values
      this.positionOverlays(
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        { top: 0, right: 0, bottom: 0, left: 0 },
        { top: 0, right: 0, bottom: 0, left: 0 },
        { top: 0, right: 0, bottom: 0, left: 0 },
      );
      this.updateTooltip(el, rect);
      return;
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

    // getBoundingClientRect returns the border-box (content + padding + border).
    // Derive the true content rect by subtracting padding and border.
    const boxSizing = cs.boxSizing;
    let contentRect: { x: number; y: number; width: number; height: number };

    if (boxSizing === 'border-box') {
      contentRect = {
        x: rect.x + border.left + padding.left,
        y: rect.y + border.top + padding.top,
        width: rect.width - border.left - border.right - padding.left - padding.right,
        height: rect.height - border.top - border.bottom - padding.top - padding.bottom,
      };
    } else {
      // content-box: getBoundingClientRect still returns border-box visually
      contentRect = {
        x: rect.x + border.left + padding.left,
        y: rect.y + border.top + padding.top,
        width: rect.width - border.left - border.right - padding.left - padding.right,
        height: rect.height - border.top - border.bottom - padding.top - padding.bottom,
      };
    }

    // --- DOM WRITES (batched) ---
    this.positionOverlays(contentRect, padding, border, margin);
    this.updateTooltip(el, rect);
  }

  /**
   * Highlight an element found by CSS selector.
   * Used for reverse sync (VSCode → browser).
   */
  drawHighlight(selector: string): void {
    const el = document.querySelector(selector);
    if (el) {
      this.draw(el);
    }
  }

  /** Hide all overlay elements. */
  clear(): void {
    const divs = [this.contentDiv, this.paddingDiv, this.borderDiv, this.marginDiv, this.tooltipDiv];
    for (const div of divs) {
      if (div) {
        div.style.display = 'none';
      }
    }
  }

  /** Remove all overlay DOM elements and reset state. */
  destroy(): void {
    const divs = [this.contentDiv, this.paddingDiv, this.borderDiv, this.marginDiv, this.tooltipDiv];
    for (const div of divs) {
      if (div && div.parentNode) {
        div.parentNode.removeChild(div);
      }
    }
    this.contentDiv = null;
    this.paddingDiv = null;
    this.borderDiv = null;
    this.marginDiv = null;
    this.tooltipDiv = null;
    this.initialized = false;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Re-create overlay elements if they were removed by page scripts. */
  private ensureInitialized(): void {
    if (!this.initialized || !this.contentDiv || !this.contentDiv.parentNode) {
      this.initialized = false;
      this.init();
    }
  }

  private createOverlayDiv(color: string): HTMLDivElement {
    const div = document.createElement('div');
    div.dataset.kiroOverlay = 'true';
    Object.assign(div.style, BASE_STYLES, { background: color });
    return div;
  }

  private createTooltipDiv(): HTMLDivElement {
    const div = document.createElement('div');
    div.dataset.kiroOverlay = 'true';
    Object.assign(div.style, TOOLTIP_STYLES);
    return div;
  }

  /**
   * Position all four overlay layers. All DOM writes are done here
   * after reads have been completed.
   */
  private positionOverlays(
    contentRect: { x: number; y: number; width: number; height: number },
    padding: { top: number; right: number; bottom: number; left: number },
    border: { top: number; right: number; bottom: number; left: number },
    margin: { top: number; right: number; bottom: number; left: number },
  ): void {
    const rects = computeBoxModelRects(contentRect, padding, border, margin);

    this.applyRect(this.contentDiv!, rects.content);
    this.applyRect(this.paddingDiv!, rects.padding);
    this.applyRect(this.borderDiv!, rects.border);
    this.applyRect(this.marginDiv!, rects.margin);
  }

  private applyRect(
    div: HTMLDivElement,
    rect: { x: number; y: number; width: number; height: number },
  ): void {
    div.style.top = rect.y + 'px';
    div.style.left = rect.x + 'px';
    div.style.width = Math.max(0, rect.width) + 'px';
    div.style.height = Math.max(0, rect.height) + 'px';
    div.style.display = 'block';
  }

  private updateTooltip(el: Element, rect: DOMRect): void {
    if (!this.tooltipDiv) {
      return;
    }

    const tag = el.tagName.toLowerCase();
    const id = el.id || null;
    const classNames = el.className && typeof el.className === 'string'
      ? el.className.trim().split(/\s+/).filter(Boolean)
      : [];

    this.tooltipDiv.textContent = buildTooltipLabel(tag, classNames, id, rect.width, rect.height);

    // Position tooltip above the element, or below if too close to top
    const tooltipY = rect.top > 24 ? rect.top - 22 : rect.bottom + 4;
    this.tooltipDiv.style.top = tooltipY + 'px';
    this.tooltipDiv.style.left = rect.left + 'px';
    this.tooltipDiv.style.display = 'block';
  }
}
