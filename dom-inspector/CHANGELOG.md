# Changelog

All notable changes to DOM Inspector are documented here.

## [0.4.1] — 2026-04-02

### Fixed
- Webview inline scripts blocked by missing CSP nonce — inspect button and all message relay now work correctly.

### Changed
- Renamed extension from "AI Terminal" to "DOM Inspector" across all commands, view IDs, and contribution points.
- Consolidated duplicate inspect commands (`pickElement` + `inspectElement`) into a single `domInspector.inspectElement` command.
- Activity bar icon changed from `$(search)` to a custom inspect SVG (`media/inspect.svg`).
- Sidebar view renamed from "Inspector" to "DOM Inspector".

## [0.4.0] — 2026-04-02

### Added
- Sidebar hover preview — hovering elements during inspection now updates the sidebar with tag, classes, and dimensions in real time.
- Property-based test suite using `fast-check` and `vitest` covering overlay rendering, box model containment, element data completeness, framework detection priority, bridge message serialization, proxy HTML injection, source mapper strategy chain, DOM attribute hints, sidebar label formatting, and chat context completeness (43 tests).

### Fixed
- Proxy crashes on malformed URLs — `new URL()` failures now return a 400 instead of crashing the request handler.
- Proxy redirects escape the iframe — 3xx `Location` headers are now rewritten to proxy-relative paths.
- Proxy garbles compressed HTML — added `accept-encoding: identity` header and fallback gzip/brotli/deflate decompression before script injection.
- Proxy double `writeHead` on error — guarded with `res.headersSent` check.

## [0.3.0] — 2026-04-01

### Added
- Full DOM Inspector implementation: overlay renderer, DOM extractor, framework detector, inspector script, bridge channel, source mapper, sidebar panel, component breadcrumb, chat context builder.
- Chrome DevTools-style box model overlays with color-coded content/padding/border/margin layers.
- Multi-strategy source resolution chain (source map → framework hook → DOM attribute → grep fallback).
- Framework detection for React, Vue (v2 & v3), Angular, and Svelte.
- Lazy-loaded DOM tree in sidebar with expand/collapse and 500-node limit per level.
- Component breadcrumb in status bar with clickable segments.
- AI chat context insertion with Markdown formatting and fenced code snippets.
- Bidirectional typed message bridge with heartbeat-based connection monitoring.

## [0.2.0] — 2026-03-28

### Added
- Initial element picker with basic overlay.
- Embedded browser panel with proxy for local dev server URLs.
- Header stripping for `X-Frame-Options` and `Content-Security-Policy`.
- Inspector script injection into proxied HTML responses.
