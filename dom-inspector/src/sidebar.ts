import * as vscode from "vscode";
import { ElementData, ChildSummary, ComputedStyleData, HoverData } from "./types";

/**
 * Format a DOM tree node label: `tag#id.class1.class2`
 */
export function formatNodeLabel(tag: string, id: string | null, classNames: string[]): string {
  let label = tag;
  if (id) label += `#${id}`;
  for (const cls of classNames) {
    label += `.${cls}`;
  }
  return label;
}

/** Callbacks the host wires up so the sidebar can communicate outward. */
export interface SidebarCallbacks {
  onNodeClicked(selector: string): void;
  onRequestChildren(selector: string): void;
}

const MAX_CHILDREN_PER_NODE = 500;

/**
 * InspectorSidebarProvider — renders element details, DOM path,
 * component hierarchy, computed styles, and a DOM tree explorer
 * inside a VSCode sidebar webview.
 */
export class InspectorSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "domInspector.inspectorSidebar";

  private view: vscode.WebviewView | undefined;
  private currentElement: ElementData | undefined;
  private domTreeRoots: ChildSummary[] = [];
  private readonly callbacks: SidebarCallbacks;

  constructor(callbacks: SidebarCallbacks) {
    this.callbacks = callbacks;
  }

  /* ------------------------------------------------------------------ */
  /*  WebviewViewProvider                                                */
  /* ------------------------------------------------------------------ */

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.buildHtml();

    webviewView.webview.onDidReceiveMessage((msg: { type: string; selector?: string }) => {
      if (msg.type === "node_clicked" && msg.selector) {
        this.callbacks.onNodeClicked(msg.selector);
      } else if (msg.type === "request_children" && msg.selector) {
        this.callbacks.onRequestChildren(msg.selector);
      }
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  /** Render full element details in the sidebar. */
  updateElement(data: ElementData): void {
    this.currentElement = data;
    this.postMessage({ type: "update_element", data });
  }

  /** Render / refresh the DOM tree with the given root children. */
  updateDOMTree(children: ChildSummary[]): void {
    this.domTreeRoots = children;
    this.postMessage({ type: "update_dom_tree", children });
  }

  /** Expand the tree to reveal and highlight a specific node. */
  expandToNode(selector: string): void {
    this.postMessage({ type: "expand_to_node", selector });
  }

  /** Lightweight hover preview — updates the element summary without full detail. */
  updateHoverPreview(data: HoverData): void {
    this.postMessage({ type: "update_hover_preview", data });
  }

  /* ------------------------------------------------------------------ */
  /*  Internals                                                         */
  /* ------------------------------------------------------------------ */

  private postMessage(msg: unknown): void {
    this.view?.webview.postMessage(msg);
  }

  private buildHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  :root {
    --bg: #0d1117;
    --bg-secondary: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --accent: #58a6ff;
    --tag-color: #ff7b72;
    --id-color: #d2a8ff;
    --class-color: #79c0ff;
    --attr-key: #79c0ff;
    --attr-val: #a5d6ff;
    --highlight-bg: rgba(88,166,255,0.12);
    --green: #3fb950;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: var(--text);
    background: var(--bg);
    overflow-y: auto;
  }
  h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    padding: 8px 12px 4px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .section { padding: 6px 12px 10px; border-bottom: 1px solid var(--border); }
  .empty-state { padding: 24px 12px; text-align: center; color: var(--text-muted); }

  /* Element summary */
  .el-tag { color: var(--tag-color); font-weight: 600; }
  .el-id { color: var(--id-color); }
  .el-class { color: var(--class-color); }
  .el-selector { font-size: 11px; color: var(--text-muted); margin-top: 2px; font-family: monospace; }
  .attr-row { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
  .attr { font-size: 11px; background: rgba(110,118,129,0.1); padding: 1px 5px; border-radius: 3px; }
  .attr-key { color: var(--attr-key); }
  .attr-val { color: var(--attr-val); }

  /* Text & HTML preview */
  .text-preview {
    margin-top: 6px; padding: 4px 8px; background: rgba(110,118,129,0.08);
    border-radius: 4px; font-size: 11px; color: var(--text-muted);
    max-height: 48px; overflow: hidden; word-break: break-word;
  }
  .html-preview {
    margin-top: 4px; padding: 4px 8px; background: rgba(110,118,129,0.08);
    border-radius: 4px; font-size: 10px; font-family: monospace;
    color: var(--text-muted); max-height: 60px; overflow: hidden;
    white-space: pre-wrap; word-break: break-all;
  }

  /* Dimensions bar */
  .dims { display: flex; gap: 8px; align-items: center; margin-top: 6px; font-size: 11px; }
  .dims .dim-label { color: var(--text-muted); }
  .dims .dim-val { color: var(--text); font-family: monospace; font-weight: 500; }

  /* Box model diagram */
  .box-model { margin-top: 6px; display: flex; justify-content: center; }
  .box-model-diagram { position: relative; text-align: center; font: 10px/1 monospace; width: 100%; max-width: 260px; }
  .bm-layer { border: 1px dashed; padding: 6px 10px; border-radius: 3px; position: relative; }
  .bm-margin { border-color: rgba(246,178,107,0.7); background: rgba(246,178,107,0.06); }
  .bm-border { border-color: rgba(255,229,153,0.7); background: rgba(255,229,153,0.06); }
  .bm-padding { border-color: rgba(147,196,125,0.7); background: rgba(147,196,125,0.06); }
  .bm-content { border-color: rgba(111,168,220,0.7); background: rgba(111,168,220,0.1); min-height: 24px; display: flex; align-items: center; justify-content: center; }
  .bm-label { position: absolute; font-size: 9px; text-transform: uppercase; letter-spacing: 0.3px; }
  .bm-margin > .bm-label { top: 1px; left: 4px; color: rgba(246,178,107,0.8); }
  .bm-border > .bm-label { top: 1px; left: 4px; color: rgba(255,229,153,0.8); }
  .bm-padding > .bm-label { top: 1px; left: 4px; color: rgba(147,196,125,0.8); }
  .bm-vals { display: flex; justify-content: space-between; font-size: 10px; color: var(--text-muted); }
  .bm-vals-v { display: flex; flex-direction: column; align-items: center; font-size: 10px; color: var(--text-muted); }
  .bm-h { display: flex; align-items: center; gap: 4px; }
  .bm-content-size { font-size: 11px; color: var(--accent); font-weight: 500; }

  /* DOM path */
  .dom-path { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
  .dom-path span { cursor: pointer; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
  .dom-path span:hover { background: var(--highlight-bg); }
  .dom-path .sep { color: var(--text-muted); cursor: default; }
  .dom-path .sep:hover { background: none; }

  /* Component hierarchy */
  .comp-path { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
  .comp-path span { padding: 1px 4px; border-radius: 3px; font-size: 11px; color: var(--accent); }
  .comp-path .sep { color: var(--text-muted); }
  .comp-detail { font-size: 11px; margin-top: 4px; }
  .comp-detail .cd-key { color: var(--text-muted); }
  .comp-detail .cd-val { color: var(--text); }
  .comp-badge { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(88,166,255,0.12); color: var(--accent); margin-top: 4px; }

  /* Computed styles */
  .style-grid { display: grid; grid-template-columns: auto 1fr; gap: 1px 8px; font-size: 11px; }
  .style-key { color: var(--attr-key); }
  .style-val { color: var(--text); word-break: break-all; }
  .color-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; border: 1px solid var(--border); vertical-align: middle; margin-right: 4px; }

  /* DOM tree */
  .tree-node {
    padding: 3px 0 3px calc(var(--depth, 0) * 16px + 6px);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    border-left: 2px solid transparent;
  }
  .tree-node:hover { background: var(--highlight-bg); }
  .tree-node.highlighted { background: rgba(88,166,255,0.22); border-left-color: var(--accent); }
  .tree-toggle {
    display: inline-block;
    width: 14px;
    text-align: center;
    color: var(--text-muted);
    flex-shrink: 0;
    user-select: none;
  }
  .tree-label .t-tag { color: var(--tag-color); }
  .tree-label .t-id { color: var(--id-color); }
  .tree-label .t-class { color: var(--class-color); }
  .tree-label .t-count { color: var(--text-muted); font-size: 10px; }
  .show-more {
    padding: 4px 12px;
    color: var(--accent);
    cursor: pointer;
    font-size: 11px;
  }
  .show-more:hover { text-decoration: underline; }

  /* Collapsible sections */
  .collapsible-header {
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .collapsible-header::before {
    content: "▸";
    display: inline-block;
    transition: transform 0.15s;
    font-size: 10px;
    color: var(--text-muted);
  }
  .collapsible-header.open::before { transform: rotate(90deg); }
  .collapsible-body { display: none; }
  .collapsible-body.open { display: block; }
</style>
</head>
<body>
  <div id="empty" class="empty-state">Pick an element in the browser to inspect it.</div>
  <div id="content" style="display:none">
    <h3>Element</h3>
    <div class="section" id="el-summary"></div>

    <h3 class="collapsible-header open" id="boxmodel-header">Box Model</h3>
    <div class="section collapsible-body open" id="box-model"></div>

    <h3>DOM Path</h3>
    <div class="section" id="dom-path"></div>

    <h3 id="comp-heading" style="display:none">Component</h3>
    <div class="section" id="comp-hierarchy" style="display:none"></div>

    <h3 class="collapsible-header" id="styles-header">Computed Styles</h3>
    <div class="section collapsible-body" id="computed-styles"></div>

    <h3 class="collapsible-header open" id="html-header">HTML</h3>
    <div class="section collapsible-body open" id="html-section"></div>

    <h3>DOM Tree</h3>
    <div id="dom-tree"></div>
  </div>
<script>
(function() {
  const vscode = acquireVsCodeApi();
  const MAX_CHILDREN = ${MAX_CHILDREN_PER_NODE};

  const $ = (id) => document.getElementById(id);
  const emptyEl = $("empty");
  const contentEl = $("content");

  /* ---- Collapsible sections ---- */
  document.querySelectorAll(".collapsible-header").forEach(h => {
    h.addEventListener("click", () => {
      h.classList.toggle("open");
      const body = h.nextElementSibling;
      if (body) body.classList.toggle("open");
    });
  });

  /* ---- State ---- */
  let treeData = {};      // selectorPath -> { node, children, expanded }
  let highlightedSel = null;

  /* ---- Helpers ---- */
  function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  function nodeLabel(tag, id, classNames, extra) {
    let h = '<span class="t-tag">' + esc(tag) + '</span>';
    if (id) h += '<span class="t-id">#' + esc(id) + '</span>';
    if (classNames && classNames.length) {
      h += classNames.map(c => '<span class="t-class">.' + esc(c) + '</span>').join("");
    }
    if (extra) h += ' ' + extra;
    return h;
  }

  function isColorValue(v) { return v && (v.startsWith('rgb') || v.startsWith('#')); }
  function colorSwatch(v) {
    if (!isColorValue(v)) return '';
    return '<span class="color-swatch" style="background:' + esc(v) + '"></span>';
  }

  /* ---- Box model diagram ---- */
  function renderBoxModel(bm) {
    if (!bm) { $("box-model").innerHTML = ''; return; }
    const c = bm.content, p = bm.padding, b = bm.border, m = bm.margin;
    const w = Math.round(c.width), h = Math.round(c.height);
    $("box-model").innerHTML =
      '<div class="box-model"><div class="box-model-diagram">' +
        '<div class="bm-layer bm-margin"><span class="bm-label">margin</span>' +
          '<div class="bm-vals"><span>' + m.left + '</span><span>' + m.right + '</span></div>' +
          '<div class="bm-h"><span class="bm-vals-v"><span>' + m.top + '</span></span>' +
          '<div class="bm-layer bm-border"><span class="bm-label">border</span>' +
            '<div class="bm-vals"><span>' + b.left + '</span><span>' + b.right + '</span></div>' +
            '<div class="bm-h"><span class="bm-vals-v"><span>' + b.top + '</span></span>' +
            '<div class="bm-layer bm-padding"><span class="bm-label">padding</span>' +
              '<div class="bm-vals"><span>' + p.left + '</span><span>' + p.right + '</span></div>' +
              '<div class="bm-h"><span class="bm-vals-v"><span>' + p.top + '</span></span>' +
              '<div class="bm-layer bm-content">' +
                '<span class="bm-content-size">' + w + ' \\u00d7 ' + h + '</span>' +
              '</div>' +
              '<span class="bm-vals-v"><span>' + p.bottom + '</span></span></div>' +
            '</div>' +
            '<span class="bm-vals-v"><span>' + b.bottom + '</span></span></div>' +
          '</div>' +
          '<span class="bm-vals-v"><span>' + m.bottom + '</span></span></div>' +
        '</div>' +
      '</div></div>';
  }

  /* ---- Element summary ---- */
  function renderElement(data) {
    emptyEl.style.display = "none";
    contentEl.style.display = "block";

    let html = '<span class="el-tag">&lt;' + esc(data.tag) + '&gt;</span>';
    if (data.id) html += ' <span class="el-id">#' + esc(data.id) + '</span>';
    if (data.classNames && data.classNames.length) {
      html += ' ' + data.classNames.map(c => '<span class="el-class">.' + esc(c) + '</span>').join(" ");
    }
    if (data.selector) {
      html += '<div class="el-selector">' + esc(data.selector) + '</div>';
    }
    if (data.boxModel && data.boxModel.content) {
      const c = data.boxModel.content;
      html += '<div class="dims">';
      html += '<span class="dim-label">W</span> <span class="dim-val">' + Math.round(c.width) + 'px</span>';
      html += '<span class="dim-label">H</span> <span class="dim-val">' + Math.round(c.height) + 'px</span>';
      html += '<span class="dim-label">X</span> <span class="dim-val">' + Math.round(c.x) + '</span>';
      html += '<span class="dim-label">Y</span> <span class="dim-val">' + Math.round(c.y) + '</span>';
      html += '</div>';
    }
    if (data.attrs && Object.keys(data.attrs).length) {
      html += '<div class="attr-row">';
      for (const [k, v] of Object.entries(data.attrs)) {
        if (k === 'class' || k === 'id' || k === 'style') continue;
        html += '<span class="attr"><span class="attr-key">' + esc(k) + '</span>=<span class="attr-val">"' + esc(String(v).slice(0, 60)) + '"</span></span> ';
      }
      html += '</div>';
    }
    if (data.text && data.text.trim()) {
      html += '<div class="text-preview">"' + esc(data.text.slice(0, 150)) + '"</div>';
    }
    $("el-summary").innerHTML = html;

    renderBoxModel(data.boxModel);

    if (data.domPath && data.domPath.length) {
      $("dom-path").innerHTML = '<div class="dom-path">' +
        data.domPath.map(seg => '<span>' + esc(seg) + '</span>').join('<span class="sep">\\u203a</span>') +
        '</div>';
    } else {
      $("dom-path").innerHTML = '<span style="color:var(--text-muted)">\\u2014</span>';
    }

    if (data.componentInfo && data.componentInfo.componentPath && data.componentInfo.componentPath.length) {
      $("comp-heading").style.display = "";
      $("comp-hierarchy").style.display = "";
      let ch = '<div class="comp-path">' +
        data.componentInfo.componentPath.map(c => '<span>' + esc(c) + '</span>').join('<span class="sep">\\u203a</span>') +
        '</div>';
      if (data.componentInfo.framework) {
        ch += '<span class="comp-badge">' + esc(data.componentInfo.framework) + '</span>';
      }
      if (data.componentInfo.componentName) {
        ch += '<div class="comp-detail"><span class="cd-key">Name: </span><span class="cd-val">' + esc(data.componentInfo.componentName) + '</span></div>';
      }
      if (data.componentInfo.sourceFile) {
        ch += '<div class="comp-detail"><span class="cd-key">Source: </span><span class="cd-val">' + esc(data.componentInfo.sourceFile) + '</span></div>';
      }
      if (data.componentInfo.sourceLine) {
        ch += '<div class="comp-detail"><span class="cd-key">Line: </span><span class="cd-val">' + data.componentInfo.sourceLine + '</span></div>';
      }
      $("comp-hierarchy").innerHTML = ch;
    } else {
      $("comp-heading").style.display = "none";
      $("comp-hierarchy").style.display = "none";
    }

    if (data.computedStyles) {
      let sg = '<div class="style-grid">';
      for (const [k, v] of Object.entries(data.computedStyles)) {
        sg += '<span class="style-key">' + esc(k) + '</span><span class="style-val">' + colorSwatch(String(v)) + esc(String(v)) + '</span>';
      }
      sg += '</div>';
      $("computed-styles").innerHTML = sg;
    }

    if (data.outerSnippet) {
      $("html-section").innerHTML = '<div class="html-preview">' + esc(data.outerSnippet) + '</div>';
    } else {
      $("html-section").innerHTML = '';
    }
  }

  /* ---- DOM Tree ---- */
  function renderTree(children) {
    treeData = {};
    const container = $("dom-tree");
    container.innerHTML = "";
    renderNodes(container, children, 0);
  }

  function renderNodes(container, children, depth) {
    const limit = Math.min(children.length, MAX_CHILDREN);
    for (let i = 0; i < limit; i++) {
      const child = children[i];
      treeData[child.selectorPath] = { node: child, children: null, expanded: false };
      container.appendChild(createTreeRow(child, depth));
    }
    if (children.length > MAX_CHILDREN) {
      const more = document.createElement("div");
      more.className = "show-more";
      more.style.setProperty("--depth", depth);
      more.textContent = "… " + (children.length - MAX_CHILDREN) + " more nodes";
      container.appendChild(more);
    }
  }

  function createTreeRow(child, depth) {
    const row = document.createElement("div");
    row.className = "tree-node";
    row.style.setProperty("--depth", depth);
    row.dataset.selector = child.selectorPath;

    const toggle = document.createElement("span");
    toggle.className = "tree-toggle";
    toggle.textContent = child.childCount > 0 ? "▸" : " ";
    row.appendChild(toggle);

    const label = document.createElement("span");
    label.className = "tree-label";
    label.innerHTML = nodeLabel(child.tag, child.id, child.classNames,
      child.childCount > 0 ? '<span class="t-count">(' + child.childCount + ')</span>' : '');
    row.appendChild(label);

    // Click to select / highlight
    label.addEventListener("click", (e) => {
      e.stopPropagation();
      highlightNode(child.selectorPath);
      vscode.postMessage({ type: "node_clicked", selector: child.selectorPath });
    });

    // Toggle expand/collapse
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      if (child.childCount === 0) return;
      const entry = treeData[child.selectorPath];
      if (!entry) return;
      if (entry.expanded) {
        collapseNode(row, child.selectorPath);
      } else {
        expandNode(row, child, depth);
      }
    });

    return row;
  }

  function expandNode(row, child, depth) {
    const entry = treeData[child.selectorPath];
    if (!entry) return;
    entry.expanded = true;
    row.querySelector(".tree-toggle").textContent = "▾";

    if (entry.children) {
      // Already fetched — render inline
      const frag = document.createDocumentFragment();
      renderNodes(frag, entry.children, depth + 1);
      row.after(frag);
    } else {
      // Request children from extension host
      vscode.postMessage({ type: "request_children", selector: child.selectorPath });
    }
  }

  function collapseNode(row, selectorPath) {
    const entry = treeData[selectorPath];
    if (!entry) return;
    entry.expanded = false;
    row.querySelector(".tree-toggle").textContent = "▸";
    // Remove child rows
    removeChildRows(row);
  }

  function removeChildRows(parentRow) {
    const parentDepth = parseInt(parentRow.style.getPropertyValue("--depth") || "0", 10);
    let next = parentRow.nextElementSibling;
    while (next) {
      const d = parseInt(next.style.getPropertyValue("--depth") || "0", 10);
      if (d <= parentDepth && !next.classList.contains("show-more")) break;
      const toRemove = next;
      next = next.nextElementSibling;
      toRemove.remove();
    }
  }

  function highlightNode(selectorPath) {
    // Remove previous highlight
    document.querySelectorAll(".tree-node.highlighted").forEach(n => n.classList.remove("highlighted"));
    highlightedSel = selectorPath;
    const row = document.querySelector('.tree-node[data-selector="' + CSS.escape(selectorPath) + '"]');
    if (row) {
      row.classList.add("highlighted");
      row.scrollIntoView({ block: "nearest" });
    }
  }

  /* ---- Incoming messages from extension host ---- */
  window.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case "update_element":
        renderElement(msg.data);
        break;

      case "update_dom_tree":
        renderTree(msg.children || []);
        break;

      case "expand_to_node": {
        highlightNode(msg.selector);
        break;
      }

      case "update_hover_preview": {
        const d = msg.data;
        if (!d) break;
        emptyEl.style.display = "none";
        contentEl.style.display = "block";
        let hh = '<span class="el-tag">&lt;' + esc(d.tag) + '&gt;</span>';
        if (d.id) hh += ' <span class="el-id">#' + esc(d.id) + '</span>';
        if (d.classNames && d.classNames.length) {
          hh += ' ' + d.classNames.map(c => '<span class="el-class">.' + esc(c) + '</span>').join(" ");
        }
        hh += '<div class="dims">';
        hh += '<span class="dim-label">W</span> <span class="dim-val">' + Math.round(d.width) + 'px</span>';
        hh += '<span class="dim-label">H</span> <span class="dim-val">' + Math.round(d.height) + 'px</span>';
        hh += '</div>';
        $("el-summary").innerHTML = hh;
        renderBoxModel(d.boxModel);
        break;
      }

      case "children_loaded": {
        const sel = msg.selector;
        const children = msg.children || [];
        const entry = treeData[sel];
        if (entry) entry.children = children;
        const parentRow = document.querySelector('.tree-node[data-selector="' + CSS.escape(sel) + '"]');
        if (parentRow) {
          const parentDepth = parseInt(parentRow.style.getPropertyValue("--depth") || "0", 10);
          const frag = document.createDocumentFragment();
          renderNodes(frag, children, parentDepth + 1);
          parentRow.after(frag);
        }
        break;
      }
    }
  });
})();
</script>
</body>
</html>`;
  }
}
