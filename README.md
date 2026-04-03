# L42 VS Code Extensions

A monorepo of VS Code / Kiro extensions built by L42. Each subdirectory is a self-contained extension with its own `package.json`, build pipeline, and VSIX output.

## Extensions

| Extension | Description | Version |
|-----------|-------------|---------|
| [dom-inspector](dom-inspector/) | Embed a browser in the editor, pick DOM elements, resolve them to source code, and build AI chat context | 0.4.3 |


## Repo structure

```
.
├── dom-inspector/          # DOM Inspector extension
│   ├── src/                # TypeScript source
│   ├── src/inspector/      # Injected browser-side modules
│   ├── tests/              # Property-based tests (fast-check + vitest)
│   ├── media/              # Icons and assets
│   ├── out/                # Compiled JS (git-ignored)
│   └── package.json
└── README.md
```

## Requirements

- Node.js ≥ 20
- pnpm
- VS Code ≥ 1.95.0 or Kiro
