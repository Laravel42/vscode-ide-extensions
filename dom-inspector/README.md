# DOM Inspector

A VS Code / Kiro extension that embeds a browser inside the editor, lets you visually pick DOM elements, resolves them back to source code, and builds rich context for AI chat — all without leaving your IDE.

## What it does

DOM Inspector opens any local dev server URL in a proxied iframe panel. You click an element on the page and the extension:

1. Highlights it with Chrome DevTools-style box model overlays (content, padding, border, margin).
2. Resolves the element to its originating source file and line using a multi-strategy mapper.
3. Opens the source file side-by-side with the matched line highlighted.
4. Populates a sidebar with element details, DOM path, component hierarchy, computed styles, and a lazy-loaded DOM tree.
5. Inserts a Markdown context block into the AI chat with element metadata and a code snippet.

## Features

### 🌐 Embedded browser

Run **`DOM Inspector: Open URL`** (`⌘⇧U` / `Ctrl+Shift+U`) to open any dev server URL directly inside an editor tab. No browser switching, no alt-tabbing.

Under the hood, a local HTTP proxy transparently:
- Strips framing restrictions (`X-Frame-Options`, `Content-Security-Policy`) so the page renders inside the editor.
- Injects the inspector runtime into every HTML response — zero config, no browser extension needed.
- Rewrites redirect `Location` headers so navigation stays within the proxy.
- Decompresses gzip / brotli / deflate on the fly before injecting the script.

The toolbar gives you a reload button, a read-only URL bar, and the inspect toggle.

---

### 🔍 Visual element inspection

Hit the **🔍** button in the toolbar or run **`DOM Inspector: Inspect Element`** (`⌘⇧I` / `Ctrl+Shift+I`).

**On hover** — every element you mouse over gets:
- Four color-coded box model overlays (content, padding, border, margin) using the same palette as Chrome DevTools.
- A floating tooltip showing `tag.class#id (width × height)`.
- A live preview in the sidebar with tag, classes, and dimensions.

**On click** — the element is "picked" and the extension captures a full snapshot:
- Tag, id, classes, all HTML attributes.
- First 200 chars of text content and 500 chars of outer HTML.
- Full DOM path from `<html>` to the element.
- Direct children summaries for tree exploration.
- Complete box model measurements (content rect, padding, border, margin).
- Key computed styles (display, position, color, background, font, sizing).

Press **Escape** at any time to cancel inspection without picking.

---

### 📁 Automatic source resolution

When you pick an element, the source mapper runs a prioritized strategy chain to find the file and line that produced it:

| Priority | Strategy | What it does |
|:--------:|----------|-------------|
| **1** | Source map | Reads `sourceFile` + `sourceLine` from the framework's devtools fiber/instance data |
| **2** | Framework hook | Searches the workspace for `ComponentName.tsx`, `.jsx`, `.vue`, or `.svelte` by naming convention |
| **3** | DOM attribute | Looks at `data-component`, `data-source`, `data-file`, `data-testid` — supports `path:line` syntax |
| **4** | Grep fallback | Searches source files for the element's id, most specific class name, or text content |

Each strategy has a 3-second timeout. The chain stops on the first hit. The matched file opens in a side-by-side editor with the line highlighted (blue glow for 10 seconds).

---

### ⚛️ Framework-aware component detection

The inspector automatically detects **React**, **Vue** (v2 & v3), **Angular**, and **Svelte** by probing well-known global hooks. Detection order is deterministic: React → Vue → Angular → Svelte.

For each picked element, the extension walks the framework's internal tree to extract:
- **Component name** — display name or function name from the nearest component ancestor.
- **Component path** — full ancestor chain from root to the current component (e.g. `App > Layout > Header > NavButton`).
- **Source file** — from React's `_debugSource`, Vue's `__file`, or Svelte's `__svelte_meta.loc`.
- **Source line** — when available from the framework's debug metadata.

---

### 📋 Sidebar panel

The DOM Inspector sidebar (accessible from the activity bar) provides a detailed breakdown of the picked element:

- **Element summary** — tag, id, classes, and every HTML attribute with syntax-highlighted key/value pairs.
- **DOM path** — clickable breadcrumb trail from root to element. Click any segment to highlight it in the browser.
- **Component hierarchy** — framework component ancestor chain, shown when a framework is detected.
- **Computed styles** — collapsible grid showing display, position, color, background, font, dimensions, and box-sizing.
- **DOM tree** — expandable, lazy-loaded tree. Children are fetched on demand (up to 500 per node with a "show more" indicator). Clicking a tree node highlights it in the browser and triggers source navigation.

The sidebar updates in real time as you hover elements during inspection.

---

### 🧭 Component breadcrumb

A status bar item shows the component path of the last picked element as a clickable breadcrumb:

```
App > Layout > Header > NavButton
```

Click any segment to simultaneously highlight the corresponding element in the browser and open its source file.

---

### 💬 AI chat context

After picking an element, the extension automatically builds a rich Markdown context block and inserts it into the AI chat prompt. The context includes:

- **Element identity** — tag, CSS selector, id, classes.
- **Content** — truncated text and HTML snippet.
- **Component info** — hierarchy path and framework name.
- **Box model** — content dimensions, padding, and margin values.
- **Source code** — a ±10 line snippet from the resolved file, with the matched line marked with `→`, inside a fenced code block with the correct language identifier (`tsx`, `jsx`, `vue`, `svelte`, `html`).

If the chat API isn't available, the context is copied to the clipboard and a notification tells you to paste it.

---

### 🔗 Bidirectional sync

The extension maintains a typed message bridge between the editor and the browser page:

- **Editor → Browser** — highlight elements, scroll to elements, expand tree nodes, start/stop inspection.
- **Browser → Editor** — hover data, picked element data, children responses, framework detection, connection status.
- **Heartbeat** — the bridge monitors `inspector_ready` signals and detects connection loss after 5 seconds (e.g. page navigation). A status bar warning appears until the connection is restored.

## Commands

| Command | Keybinding | Description |
|---------|-----------|-------------|
| `DOM Inspector: Open URL` | ⌘⇧U | Open a URL in the embedded browser panel |
| `DOM Inspector: Inspect Element` | ⌘⇧I | Enter element inspection mode |

## Architecture

```
┌─────────────────────────────────────────────────┐
│  VS Code / Kiro                                 │
│                                                 │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐ │
│  │ Extension │──│  Bridge   │──│   Webview    │ │
│  │   Host    │  │  Channel  │  │  (browser)   │ │
│  └────┬─────┘  └───────────┘  └──────┬───────┘ │
│       │                              │          │
│  ┌────┴─────┐                 ┌──────┴───────┐  │
│  │  Source   │                │   Proxy      │  │
│  │  Mapper   │                │  (localhost)  │  │
│  ├──────────┤                 └──────┬───────┘  │
│  │ Sidebar  │                        │          │
│  ├──────────┤                 ┌──────┴───────┐  │
│  │Breadcrumb│                 │  Inspector   │  │
│  ├──────────┤                 │   Script     │  │
│  │  Chat    │                 │  (injected)  │  │
│  │ Context  │                 └──────────────┘  │
│  └──────────┘                                   │
└─────────────────────────────────────────────────┘
```


### Key modules

| Module | Location | Context |
|--------|----------|---------|
| `extension.ts` | Extension host | Command registration, orchestration, webview HTML |
| `proxy.ts` | Extension host | HTTP proxy with header stripping and script injection |
| `bridge.ts` | Extension host | Typed message relay with heartbeat monitoring |
| `source-mapper.ts` | Extension host | Multi-strategy source file resolution |
| `sidebar.ts` | Extension host | Webview sidebar with element details and DOM tree |
| `breadcrumb.ts` | Extension host | Status bar component path display |
| `chat-context.ts` | Extension host | Markdown context builder for AI chat |
| `inspector/overlay-renderer.ts` | Injected (browser) | Box model overlay rendering |
| `inspector/dom-extractor.ts` | Injected (browser) | DOM data extraction and selector generation |
| `inspector/framework-detector.ts` | Injected (browser) | Framework detection and component info extraction |
| `inspector/inspector-script.ts` | Injected (browser) | Inspection mode orchestration (mousemove, click, escape) |

### Message flow

1. User clicks 🔍 → webview sends `start_inspector` to iframe via `postMessage`.
2. Inspector script attaches mousemove/click listeners, draws overlays on hover.
3. User clicks an element → inspector sends `element_picked` to webview via `parent.postMessage`.
4. Webview relay forwards to extension host via `vscode.postMessage`.
5. Extension host runs source mapper → opens file → updates sidebar → updates breadcrumb → inserts chat context.

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Run tests (property-based tests with fast-check)
pnpm test

# Package VSIX
pnpm run package

# Build, package, and install all extensions
./rebuild-all.sh
```

## Requirements

- VS Code ≥ 1.95.0 or Kiro
- Node.js ≥ 20
- pnpm

## License

Proprietary — L42

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.
