/**
 * InspectorScript — Injected page module (runs in browser context).
 *
 * Main entry point for the DOM inspector. Wires together OverlayRenderer,
 * DOMExtractor, and FrameworkDetector. Handles mouse events, keyboard
 * shortcuts, and message passing to/from the extension host via
 * window.parent.postMessage.
 *
 * This module must NOT import vscode or any Node.js modules.
 * Type-only imports from '../types' are stripped at bundle time.
 */

import type { BridgeMessage, ElementData, HoverData } from '../types';
import { OverlayRenderer } from './overlay-renderer';
import { DOMExtractor } from './dom-extractor';
import { FrameworkDetector } from './framework-detector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Post a typed BridgeMessage to the parent frame (webview shell). */
function postToParent(msg: BridgeMessage): void {
  try {
    window.parent.postMessage(msg, '*');
  } catch (e) {
    console.warn('[kiro-inspector] Failed to post message:', e);
  }
}

/** Check whether an element is one of our overlay elements. */
function isOverlayElement(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) {
    return false;
  }
  return el.dataset.kiroOverlay === 'true';
}

// ---------------------------------------------------------------------------
// InspectorScript
// ---------------------------------------------------------------------------

class InspectorScript {
  private overlay: OverlayRenderer;
  private extractor: DOMExtractor;
  private detector: FrameworkDetector;

  private inspecting = false;
  private rafPending = false;
  private lastMouseEvent: MouseEvent | null = null;

  // Bound handlers for add/removeEventListener
  private boundOnMouseMove: (e: MouseEvent) => void;
  private boundOnClick: (e: MouseEvent) => void;
  private boundOnEscape: (e: KeyboardEvent) => void;
  private boundOnMessage: (e: MessageEvent) => void;

  constructor() {
    this.overlay = new OverlayRenderer();
    this.extractor = new DOMExtractor();
    this.detector = new FrameworkDetector();

    this.boundOnMouseMove = this.onMouseMove.bind(this);
    this.boundOnClick = this.onClick.bind(this);
    this.boundOnEscape = this.onEscape.bind(this);
    this.boundOnMessage = this.handleMessage.bind(this);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Initialize the inspector: listen for incoming messages, signal ready. */
  init(): void {
    window.addEventListener('message', this.boundOnMessage);

    // Signal that the inspector script is loaded and ready
    postToParent({ type: 'inspector_ready' });

    // Detect framework and report
    const framework = this.detector.detect();
    if (framework) {
      postToParent({ type: 'framework_detected', framework });
    }
  }

  // -----------------------------------------------------------------------
  // Inspection mode
  // -----------------------------------------------------------------------

  /** Enter inspection mode — attach mouse/keyboard listeners. */
  startInspection(): void {
    if (this.inspecting) {
      return;
    }

    this.inspecting = true;
    this.overlay.init();

    document.addEventListener('mousemove', this.boundOnMouseMove, true);
    document.addEventListener('click', this.boundOnClick, true);
    document.addEventListener('keydown', this.boundOnEscape, true);
  }

  /** Exit inspection mode — detach listeners, clear overlay. */
  stopInspection(): void {
    if (!this.inspecting) {
      return;
    }

    this.inspecting = false;
    this.rafPending = false;
    this.lastMouseEvent = null;

    document.removeEventListener('mousemove', this.boundOnMouseMove, true);
    document.removeEventListener('click', this.boundOnClick, true);
    document.removeEventListener('keydown', this.boundOnEscape, true);

    this.overlay.clear();
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  /**
   * Mousemove handler — throttled via requestAnimationFrame for 60fps.
   * Stores the latest event and schedules a single rAF callback.
   */
  private onMouseMove(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();

    this.lastMouseEvent = e;

    if (!this.rafPending) {
      this.rafPending = true;
      requestAnimationFrame(() => {
        this.rafPending = false;
        this.processMouseMove();
      });
    }
  }

  /** Process the most recent mousemove event inside a rAF callback. */
  private processMouseMove(): void {
    const e = this.lastMouseEvent;
    if (!e || !this.inspecting) {
      return;
    }

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isOverlayElement(el)) {
      return;
    }

    // Draw overlay
    this.overlay.draw(el);

    // Send lightweight hover data
    const hoverData: HoverData = this.extractor.getHoverData(el);
    postToParent({ type: 'element_hovered', data: hoverData });
  }

  /**
   * Click handler — captures full element data, sends it, and exits
   * inspection mode.
   */
  private onClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isOverlayElement(el)) {
      return;
    }

    // Capture full element data
    const elementData: ElementData = this.extractor.getFullData(el);

    // Enrich with framework component info
    elementData.componentInfo = this.detector.getComponentInfo(el);

    // Send picked element data
    postToParent({ type: 'element_picked', data: elementData });

    // Exit inspection mode after pick
    this.stopInspection();
  }

  /** Escape key handler — cancels inspection mode. */
  private onEscape(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();

      postToParent({ type: 'element_pick_cancelled' });
      this.stopInspection();
    }
  }

  // -----------------------------------------------------------------------
  // Incoming message handler
  // -----------------------------------------------------------------------

  /** Handle messages from the parent frame (webview shell / extension host). */
  private handleMessage(e: MessageEvent): void {
    const msg = e.data;
    if (!msg || typeof msg.type !== 'string') {
      return;
    }

    switch (msg.type) {
      case 'start_inspector':
        this.startInspection();
        break;

      case 'stop_inspector':
        this.stopInspection();
        break;

      case 'highlight_element':
        if (typeof msg.selector === 'string') {
          this.overlay.init();
          this.overlay.drawHighlight(msg.selector);
        }
        break;

      case 'scroll_to_element':
        if (typeof msg.selector === 'string') {
          this.scrollToElement(msg.selector);
        }
        break;

      case 'get_children':
        if (typeof msg.selector === 'string') {
          const children = this.extractor.getChildren(msg.selector);
          postToParent({
            type: 'children_response',
            selector: msg.selector,
            children,
          });
        }
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  /** Scroll an element into view by CSS selector. */
  private scrollToElement(selector: string): void {
    const el = document.querySelector(selector);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  }
}

// ---------------------------------------------------------------------------
// Initialization — exported for IIFE wrapping
// ---------------------------------------------------------------------------

/**
 * Initialize the InspectorScript. Call this once when the script is injected
 * into the page. Sets up message listeners and signals readiness.
 */
export function initInspector(): void {
  const inspector = new InspectorScript();
  inspector.init();
}
