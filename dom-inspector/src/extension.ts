import * as vscode from "vscode";
import * as path from "path";
import { startProxy, stopProxy } from "./proxy";
import { BridgeChannel } from "./bridge";
import { SourceMapper } from "./source-mapper";
import { InspectorSidebarProvider } from "./sidebar";
import { ComponentBreadcrumb } from "./breadcrumb";
import { ChatContextBuilder } from "./chat-context";
import { BridgeMessage, ElementData, ComponentPathEntry } from "./types";

let browserPanel: vscode.WebviewPanel | undefined;
let bridge: BridgeChannel | undefined;

const sourceMapper = new SourceMapper();
const breadcrumb = new ComponentBreadcrumb();
const chatContext = new ChatContextBuilder();

let connectionLostMsg: vscode.Disposable | undefined;
let inspecting = false;

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("DOM Inspector");
  output.appendLine("DOM Inspector activated");

  // --- Sidebar provider ---
  const sidebarProvider = new InspectorSidebarProvider({
    onNodeClicked(selector: string) {
      // Send highlight + scroll back through bridge, then navigate source
      if (bridge) {
        bridge.sendToPage({ type: "highlight_element", selector });
        bridge.sendToPage({ type: "scroll_to_element", selector });
      }
      // Attempt source navigation for the clicked node
      navigateSourceForSelector(selector);
    },
    onRequestChildren(selector: string) {
      if (bridge) {
        bridge.sendToPage({ type: "get_children", selector });
      }
    },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      InspectorSidebarProvider.viewType,
      sidebarProvider,
    ),
  );

  // --- Breadcrumb segment click handler ---
  breadcrumb.onSegmentClicked((component: ComponentPathEntry) => {
    if (component.selector && bridge) {
      bridge.sendToPage({ type: "highlight_element", selector: component.selector });
      bridge.sendToPage({ type: "scroll_to_element", selector: component.selector });
    }
    if (component.sourceFile) {
      openSourceFile(component.sourceFile, 1);
    }
  });

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand("domInspector.openUrl", () => openUrl(sidebarProvider)),
    vscode.commands.registerCommand("domInspector.inspectElement", () => activateInspection(sidebarProvider)),
  );

  context.subscriptions.push({ dispose: () => breadcrumb.dispose() });
}

function getCwd(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.env.HOME || "/";
}

// ---------------------------------------------------------------------------
// Open URL — create browser panel with proxy
// ---------------------------------------------------------------------------

async function openUrl(sidebarProvider: InspectorSidebarProvider) {
  const url = await vscode.window.showInputBox({
    prompt: "Enter URL to open",
    placeHolder: "http://localhost:5173",
    value: "http://localhost:5173",
  });
  if (!url) return;

  sidebarProvider.log(`opening ${url}`);
  const proxyPort = await startProxy(url);
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;
  sidebarProvider.log(`proxy on :${proxyPort}`);

  if (browserPanel) {
    browserPanel.webview.html = getBrowserHtml(browserPanel.webview, proxyUrl, url);
    browserPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  browserPanel = vscode.window.createWebviewPanel(
    "domInspectorBrowser",
    `🌐 ${new URL(url).hostname}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  browserPanel.webview.html = getBrowserHtml(browserPanel.webview, proxyUrl, url);

  // Initialize BridgeChannel
  bridge = new BridgeChannel(browserPanel);
  wireUpBridge(bridge, sidebarProvider);

  browserPanel.onDidDispose(() => {
    bridge?.dispose();
    bridge = undefined;
    browserPanel = undefined;
    inspecting = false;
    stopProxy();
  });
}

// ---------------------------------------------------------------------------
// Activate inspection mode
// ---------------------------------------------------------------------------

function activateInspection(sidebarProvider: InspectorSidebarProvider) {
  if (!browserPanel || !bridge) {
    vscode.window.showWarningMessage(
      "Open a URL first (⌘⇧U), then pick an element.",
    );
    return;
  }
  sidebarProvider.log("starting inspection");
  browserPanel.reveal(vscode.ViewColumn.One);
  bridge.sendToPage({ type: "start_inspector" });
  sidebarProvider.log("sent start_inspector to page");
  inspecting = true;
}

// ---------------------------------------------------------------------------
// Bridge message handler
// ---------------------------------------------------------------------------

function wireUpBridge(
  br: BridgeChannel,
  sidebarProvider: InspectorSidebarProvider,
) {
  br.onMessage((msg: BridgeMessage) => {
    sidebarProvider.log(`bridge ← ${msg.type}`);
    switch (msg.type) {
      case "element_picked":
        inspecting = false;
        sidebarProvider.log(`picked: <${msg.data.tag}> ${msg.data.selector}`);
        handleElementPicked(msg.data, sidebarProvider);
        break;

      case "element_hovered":
        sidebarProvider.updateHoverPreview(msg.data);
        break;

      case "element_pick_cancelled":
        inspecting = false;
        sidebarProvider.log("inspection cancelled (Escape)");
        break;

      case "children_response":
        sidebarProvider.log(`children: ${msg.children.length} for ${msg.selector}`);
        sidebarProvider.updateDOMTree(msg.children);
        break;

      case "framework_detected":
        sidebarProvider.log(`framework: ${msg.framework}`);
        break;

      case "inspector_ready":
        sidebarProvider.log("inspector ready (page loaded)");
        // Request root-level children to populate the DOM tree
        br.sendToPage({ type: "get_children", selector: "body" });
        break;

      default:
        break;
    }
  });

  br.onConnectionLost(() => {
    sidebarProvider.log("connection lost");
    connectionLostMsg?.dispose();
    connectionLostMsg = vscode.window.setStatusBarMessage(
      "$(warning) Inspector connection lost — waiting for page reload…",
    );
  });

  br.onConnectionRestored(() => {
    connectionLostMsg?.dispose();
    connectionLostMsg = undefined;
    vscode.window.setStatusBarMessage("$(check) Inspector reconnected", 3000);
  });
}

// ---------------------------------------------------------------------------
// Handle element_picked
// ---------------------------------------------------------------------------

async function handleElementPicked(
  element: ElementData,
  sidebarProvider: InspectorSidebarProvider,
) {
  const cwd = getCwd();

  // 1. Run SourceMapper
  const source = await sourceMapper.resolve(element, cwd);
  sidebarProvider.log(`source: ${source ? source.strategy + " → " + source.filePath + ":" + source.line : "not found"}`);

  // 2. Open file side by side and highlight line
  let snippet = "";
  if (source) {
    const fullPath = path.resolve(cwd, source.filePath);
    snippet = chatContext.extractSnippet(fullPath, source.line);
    await openSourceFile(fullPath, source.line);
  } else {
    vscode.window.showWarningMessage(
      `Could not find source for <${element.tag}> "${(element.text || "").slice(0, 40)}"`,
    );
  }

  // 3. Update sidebar
  sidebarProvider.updateElement(element);
  sidebarProvider.log(`element has ${element.children?.length || 0} direct children`);
  if (element.children && element.children.length > 0) {
    sidebarProvider.updateDOMTree(element.children);
  }
  if (element.selector) {
    sidebarProvider.expandToNode(element.selector);
  }

  // 4. Update breadcrumb
  const components: ComponentPathEntry[] = [];
  if (element.componentInfo?.componentPath) {
    for (const name of element.componentInfo.componentPath) {
      components.push({
        name,
        sourceFile: null,
        selector: null,
      });
    }
    // Enrich the last entry with source info if available
    if (components.length > 0 && element.componentInfo.sourceFile) {
      components[components.length - 1].sourceFile =
        element.componentInfo.sourceFile;
    }
  }
  breadcrumb.show(components);

  // 5. Build and insert chat context
  const contextMsg = chatContext.build(element, source, snippet);
  await chatContext.insertIntoChat(contextMsg);
}

// ---------------------------------------------------------------------------
// Source navigation helpers
// ---------------------------------------------------------------------------

async function openSourceFile(
  filePathOrAbsolute: string,
  line: number,
): Promise<void> {
  try {
    const absPath = path.isAbsolute(filePathOrAbsolute)
      ? filePathOrAbsolute
      : path.resolve(getCwd(), filePathOrAbsolute);

    const fileUri = vscode.Uri.file(absPath);
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const lineIdx = Math.max(0, line - 1);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Two,
      preserveFocus: false,
    });

    const lineText = doc.lineAt(lineIdx).text;
    const range = new vscode.Range(lineIdx, 0, lineIdx, lineText.length);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

    const decoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(88, 166, 255, 0.15)",
      border: "1px solid rgba(88, 166, 255, 0.4)",
      isWholeLine: true,
    });
    editor.setDecorations(decoration, [range]);
    setTimeout(() => decoration.dispose(), 10000);
  } catch {
    // File may not exist or be unreadable
  }
}

async function navigateSourceForSelector(selector: string): Promise<void> {
  const cwd = getCwd();
  // Build a minimal ElementData to pass to source mapper
  const minimalElement: ElementData = {
    selector,
    tag: "",
    id: null,
    classNames: [],
    attrs: {},
    text: "",
    outerSnippet: "",
    domPath: [],
    children: [],
    boxModel: {
      content: { x: 0, y: 0, width: 0, height: 0 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    computedStyles: {
      display: "",
      position: "",
      color: "",
      backgroundColor: "",
      fontSize: "",
      fontFamily: "",
      width: "",
      height: "",
      boxSizing: "",
    },
    componentInfo: null,
  };

  const source = await sourceMapper.resolve(minimalElement, cwd);
  if (source) {
    const fullPath = path.resolve(cwd, source.filePath);
    await openSourceFile(fullPath, source.line);
  }
}

// ---------------------------------------------------------------------------
// Browser panel webview HTML with typed BridgeChannel relay
// ---------------------------------------------------------------------------

function getBrowserHtml(webview: vscode.Webview, proxyUrl: string, originalUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #0d1117; }
    body { display: flex; flex-direction: column; height: 100vh; }
    .toolbar {
      display: flex; align-items: center; gap: 4px; padding: 6px 8px;
      background: #161b22; border-bottom: 1px solid #30363d; flex-shrink: 0;
    }
    .toolbar input {
      flex: 1; background: #0d1117; border: 1px solid #30363d; border-radius: 4px;
      color: #e6edf3; padding: 6px 10px; font: 13px/1 system-ui; outline: none;
      min-width: 0;
    }
    .toolbar input:focus { border-color: #58a6ff; }
    .tb {
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      background: #21262d; border: 1px solid #30363d; border-radius: 6px;
      color: #e6edf3; cursor: pointer; font-size: 16px;
      flex-shrink: 0; transition: background 0.12s, border-color 0.12s, color 0.12s;
    }
    .tb:hover { background: #30363d; }
    .tb.inspecting {
      background: #0d4429; border-color: #3fb950; color: #3fb950;
      animation: pulse 1.5s infinite;
    }
    .tb svg { width: 18px; height: 18px; fill: currentColor; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
    iframe { flex: 1; width: 100%; border: none; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="tb" id="reload" title="Reload page">
      <svg viewBox="0 0 16 16"><path d="M13.5 2a.5.5 0 0 0-.5.5V5H10a.5.5 0 0 0 0 1h3.5a.5.5 0 0 0 .5-.5V2.5a.5.5 0 0 0-.5-.5zM8 3a5 5 0 0 0-4.55 2.93.5.5 0 1 0 .91.42A4 4 0 1 1 4 9.52a.5.5 0 1 0-.71.71A5 5 0 1 0 8 3z"/></svg>
    </button>
    <input id="url" type="text" value="${originalUrl}" readonly>
    <button class="tb" id="inspect" title="Inspect element (⌘⇧I)">
      <svg viewBox="0 0 16 16"><path d="M1 1v14h14V1H1zm1 1h12v12H2V2zm2 2v2h1V5h1V4H4zm5 0v1h1v1h1V4H9zM7 7v2h2V7H7zm-3 3v2h2v-1H5v-1H4zm6 0v1h-1v1h2v-2h-1z"/></svg>
    </button>
  </div>
  <iframe id="frame" src="${proxyUrl}"></iframe>
  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      const frame = document.getElementById('frame');
      const inspectBtn = document.getElementById('inspect');

      // ---- Typed BridgeChannel relay ----
      // All BridgeMessage types that flow Extension Host → Inspector Script (page)
      const TO_PAGE_TYPES = [
        'start_inspector', 'stop_inspector',
        'highlight_element', 'scroll_to_element', 'get_children'
      ];
      // All BridgeMessage types that flow Inspector Script (page) → Extension Host
      const TO_HOST_TYPES = [
        'element_hovered', 'element_picked', 'element_pick_cancelled',
        'children_response', 'framework_detected', 'inspector_ready'
      ];

      let isInspecting = false;

      function setInspecting(active) {
        isInspecting = active;
        inspectBtn.classList.toggle('inspecting', active);
      }

      // ---- Messages from Extension Host → forward to iframe (page) ----
      window.addEventListener('message', function(ev) {
        const msg = ev.data;
        if (!msg || typeof msg.type !== 'string') return;
        console.log('[webview] message received:', msg.type, 'from origin:', ev.origin);

        // If it's a message type destined for the page, relay to iframe
        if (TO_PAGE_TYPES.indexOf(msg.type) !== -1) {
          if (msg.type === 'start_inspector') setInspecting(true);
          if (msg.type === 'stop_inspector') setInspecting(false);
          try { frame.contentWindow.postMessage(msg, '*'); } catch(e) {}
          return;
        }

        // If it's a message type from the page (via iframe postMessage), relay to extension host
        if (TO_HOST_TYPES.indexOf(msg.type) !== -1) {
          if (msg.type === 'element_picked' || msg.type === 'element_pick_cancelled') {
            setInspecting(false);
          }
          vscode.postMessage(msg);
          return;
        }
      });

      // ---- Toolbar buttons ----
      document.getElementById('reload').onclick = function() { frame.src = frame.src; };

      inspectBtn.onclick = function() {
        console.log('[webview] inspect button clicked, isInspecting:', isInspecting);
        if (isInspecting) {
          try { frame.contentWindow.postMessage({ type: 'stop_inspector' }, '*'); } catch(e) { console.error('[webview] postMessage failed:', e); }
          vscode.postMessage({ type: 'stop_inspector' });
          setInspecting(false);
        } else {
          try { frame.contentWindow.postMessage({ type: 'start_inspector' }, '*'); } catch(e) { console.error('[webview] postMessage failed:', e); }
          vscode.postMessage({ type: 'start_inspector' });
          setInspecting(true);
        }
      };
    })();
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

export function deactivate() {
  bridge?.dispose();
  bridge = undefined;
  breadcrumb.dispose();
  stopProxy();
}
