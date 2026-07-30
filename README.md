# ChatPlus

Local-first AI chat: threaded conversations, ambiguity bypasses, Markdown tree export, and context-depth controls.

[中文说明](./README.zh-CN.md) · [Project site](https://origin-technology-co-ltd.github.io/chat-plus/)

## Features

- **Multi-model configs** — store named credentials (display name / API key / base URL / model), pick a global default, and switch per session
- Streaming multi-turn chat; main thread and bypasses share the session’s resolved model
- Local persistence (SQLite)
- Bring your own API key — OpenAI-compatible endpoints (OpenAI, DeepSeek, Ollama, …)
- **Ambiguity bypass (v2)** — select text, open a nested side column with vertical tabs; include descendants; optional summarize-when-over-budget
- Export as a **nested directory tree** with relative links (full session tree, not the sliding window)
- **Context depth** — token estimate + window usage; optional auto sliding window (UI keeps full history)
- **UI language** — English / Chinese; defaults from the OS, overridable in Settings

## Requirements

- Node.js ≥ 20
- pnpm ≥ 9

## Quick start

```bash
pnpm install
pnpm dev
```

- Frontend: http://localhost:18770
- Backend: http://127.0.0.1:18771

Ports are defined in `ports.json` so browser and desktop do not collide:

| Mode | Frontend | Backend |
|------|----------|---------|
| Web (`pnpm dev`) | 18770 | 18771 |
| Desktop (`tauri:dev`) | 18772 | 18773 |
| Desktop (packaged) | embedded (no Vite port) | 18773 |

On first launch, open **Settings**, add at least one model config, and set it as default. Adjust context window and trim settings as needed. Legacy single API key / base URL / model settings migrate automatically on first read.

## Desktop

```bash
pnpm tauri:dev
pnpm tauri:build
```

Desktop builds package the frontend together with a Tauri-managed backend sidecar on `127.0.0.1:18773`. The app stores SQLite/config data in the OS application data directory for `com.origintech.chatplus`, isolated from browser development data.

CI: Actions → **Desktop build** (`workflow_dispatch` or `v*` tags) uploads macOS / Windows / Linux installers as workflow artifacts (no Release / signing yet).

## Data directory

Default DB path for browser development: `./data/chatplus.db`.

Override with:

```bash
export CHATPLUS_DATA_DIR=~/.chatplus
pnpm dev
```

## Ambiguity bypass (v2)

1. In any pane, **select** text → **right-click** → open bypass (optional full upstream context)
2. The source pane narrows; a new column appears; sibling bypasses use **vertical tabs**; nesting continues
3. Child panes can check “include in parent”; panes with a subtree can include all descendants
4. On send, included messages are assembled, then the sliding window applies; if over budget you can **auto-summarize** (decline skips send)
5. Export writes `index.md` + `threads/...` with relative links between parent and bypass docs

## Export

- Default folder: `~/Documents/chatplus/exports/`
- Change the path in Settings, or ask for a path on each export
- Export always includes the **full bypass tree** (not limited by the sliding window)
- Front matter `model` is the session’s current model; attributed assistant blocks include a `model:` line

## Context settings

| Setting | Default | Notes |
|---------|---------|--------|
| Context window cap | 128000 | Used for usage % and budget |
| Auto sliding window | on | Off → send full history upstream |
| Keep recent turns | 20 | One turn ≈ one user question |
| Target occupancy | 0.7 | After turn trim, tighten by token budget |

## Scripts

```bash
pnpm typecheck   # Typecheck backend + frontend
pnpm build       # Build both packages
```

## Publishing / mirror

The public GitHub mirror is updated from the development tree via GitHub Actions (allowlisted paths only). Maintainers: see [docs/PUBLISH.md](./docs/PUBLISH.md) for `PUBLIC_REPO_TOKEN` and GitHub Pages (`/docs`) setup.

## Roadmap (not implemented)

- LLM summaries instead of routine sliding-window trim
- Message-level include controls / context inspector
- Per-model context window overrides
- Multi-AI chat rooms (assigned / free chat / meeting modes)
