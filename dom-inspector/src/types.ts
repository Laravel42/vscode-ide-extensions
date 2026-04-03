/**
 * Shared types and interfaces for the DOM Inspector feature.
 *
 * These types are used across the injected page modules, bridge layer,
 * and extension host services.
 */

// ---------------------------------------------------------------------------
// Framework
// ---------------------------------------------------------------------------

export type FrameworkType = 'react' | 'vue' | 'angular' | 'svelte' | null;

// ---------------------------------------------------------------------------
// Box Model & Computed Styles
// ---------------------------------------------------------------------------

export interface BoxModelData {
  content: { x: number; y: number; width: number; height: number };
  padding: { top: number; right: number; bottom: number; left: number };
  border: { top: number; right: number; bottom: number; left: number };
  margin: { top: number; right: number; bottom: number; left: number };
}

export interface ComputedStyleData {
  display: string;
  position: string;
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontFamily: string;
  width: string;
  height: string;
  boxSizing: string;
}

// ---------------------------------------------------------------------------
// Component & Source Information
// ---------------------------------------------------------------------------

export interface ComponentInfo {
  framework: FrameworkType;
  componentName: string;
  componentPath: string[];     // Ancestor chain, e.g. ['App', 'Layout', 'Header', 'NavButton']
  sourceFile: string | null;   // Path from framework devtools hook
  sourceLine: number | null;
}

export interface ComponentPathEntry {
  name: string;
  sourceFile: string | null;
  selector: string | null;
}


export interface SourceLocation {
  filePath: string;          // Workspace-relative path
  line: number;              // 1-based line number
  column?: number;           // 1-based column (when available from source maps)
  strategy: 'sourcemap' | 'framework' | 'attribute' | 'grep';
}

// ---------------------------------------------------------------------------
// DOM Element Data
// ---------------------------------------------------------------------------

export interface ChildSummary {
  tag: string;
  id: string | null;
  classNames: string[];
  childCount: number;
  selectorPath: string;        // Unique path for later retrieval
}

export interface HoverData {
  tag: string;
  id: string | null;
  classNames: string[];
  width: number;
  height: number;
  boxModel: BoxModelData;
}

export interface ElementData {
  // Identity
  selector: string;
  tag: string;
  id: string | null;
  classNames: string[];
  attrs: Record<string, string>;

  // Content
  text: string;                    // First 200 chars of textContent
  outerSnippet: string;            // First 500 chars of outerHTML

  // Structure
  domPath: string[];               // e.g. ['html', 'body', 'div#app', 'main', 'section.hero']
  children: ChildSummary[];        // Direct children summaries

  // Layout
  boxModel: BoxModelData;
  computedStyles: ComputedStyleData;

  // Framework
  componentInfo: ComponentInfo | null;
}

// ---------------------------------------------------------------------------
// Bridge Messages
// ---------------------------------------------------------------------------

export type BridgeMessage =
  // Extension Host → Inspector Script
  | { type: 'start_inspector' }
  | { type: 'stop_inspector' }
  | { type: 'highlight_element'; selector: string }
  | { type: 'scroll_to_element'; selector: string }
  | { type: 'get_children'; selector: string }
  // Inspector Script → Extension Host
  | { type: 'element_hovered'; data: HoverData }
  | { type: 'element_picked'; data: ElementData }
  | { type: 'element_pick_cancelled' }
  | { type: 'children_response'; selector: string; children: ChildSummary[] }
  | { type: 'framework_detected'; framework: FrameworkType }
  | { type: 'inspector_ready' }
  // Bidirectional
  | { type: 'connection_lost' }
  | { type: 'connection_restored' };
