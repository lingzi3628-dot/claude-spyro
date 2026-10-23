# Claude-Free

A browser-based, provider-agnostic AI coding agent — a free, open alternative to Claude Code that runs in your browser while executing real tools (bash, file edits, search) on your machine.

```
┌──────────────────────────┐
│   Browser UI (React)     │  chat, diffs, tool cards, approvals
└────────────┬─────────────┘
             │ WebSocket
┌────────────▼─────────────┐
│  Local Agent Server      │  agent loop + provider adapter + tools
│  (Node / TypeScript)     │
└────────────┬─────────────┘
             │
       filesystem + shell  ← runs on YOUR machine
```

## Why a local backend?

Browsers can't run bash or touch the filesystem (security sandbox). Claude Code runs locally for the same reason. Claude-Free keeps a small local Node server as the "brain" and uses the browser purely as the UI — so you get **the browser UX of a web app with the real power of a local agent**.

## Features

- **Any model** — OpenRouter, Ollama (local, free), OpenAI, Anthropic, or any OpenAI-compatible endpoint (LM Studio, vLLM, Groq, DeepSeek, Together, Cerebras…)
- **Real tools** — `bash`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `list_dir`, `webfetch`
- **Streaming** responses with live tool-call cards
- **Approval flow** — auto-approve toggle, or approve each dangerous action
- **Plugin system** — drop `.mjs` files in `plugins/` to add tools
- **Cancel / reset**, sessions, and per-user model settings from the UI

## Quick start

```bash
npm install
npm run build       # builds web UI + server
npm start
```

Open **http://localhost:8787**. On first run a setup wizard walks you through
choosing a provider, adding a key, and picking a model — then you can start building.

## Install as a desktop app

The fastest way to use Claude-Free on a PC is the **native desktop app**: its own
window, its own icon, no browser, and **no dependencies to install**. The server,
the UI and the Node runtime are all bundled inside the app.

| Platform | File | Install |
| --- | --- | --- |
| Linux | `Claude-Free Spyro-<v>-x86_64.AppImage` | `chmod +x *.AppImage && ./Claude-Free*.AppImage` |
| Linux (Debian/Ubuntu) | `Claude-Free Spyro-<v>-amd64.deb` | `sudo apt install ./Claude-Free*.deb` |
| Windows | `Claude-Free Spyro-<v>-Setup.exe` | Run it, pick a folder |
| macOS | `Claude-Free Spyro-<v>.dmg` | Drag to Applications |

Build it yourself:

```bash
npm install
npm run desktop:linux     # or desktop (current platform)
# -> dist-desktop/
```

The app needs no Node installed: it runs its own server using the Node runtime
embedded in Electron. Set `CLAUDE_FREE_PORT` if 8787 is taken.

### Headless / scripting

```bash
claude-free -p "summarise README.md"                # one-shot
claude-free -p "review the diff" --json | jq .      # JSON events
claude-free -p "fix the tests" --max-turns 40       # longer runs
```

Run `claude-free --help` for every flag. Headless reuses a running server if
there is one, otherwise starts a temporary one and shuts it down afterwards.

### Development (hot reload)

```bash
npm run dev
# server on :8787, web on :5173 (proxies /ws and /api to the server)
```

## Configuring a model

Use the in-app **Model Settings** panel, or set environment variables:

```bash
# OpenRouter
PROVIDER=openrouter MODEL=z-ai/glm-4.5-air:free API_KEY=sk-or-... npm start

# Ollama (local, no key)
PROVIDER=ollama MODEL=qwen2.5-coder:7b npm start

# Anthropic
PROVIDER=anthropic MODEL=claude-sonnet-4-5 API_KEY=sk-ant-... npm start
```

Settings are persisted to `~/.claude-free/config.json`.

### Free / local options

| Provider | Notes |
| --- | --- |
| **Ollama** | Fully free & offline. Try `qwen2.5-coder:7b`, `deepseek-coder-v2`, `llama3.1:8b`. Best for users with a decent GPU/RAM. |
| **OpenRouter `:free` models** | Free tier models, e.g. `z-ai/glm-4.5-air:free`, `deepseek/deepseek-chat-v3-0324:free`, `qwen/qwen3-coder:free`. Requires a free OpenRouter key. |
| **Groq / Cerebras / Gemini** | Free tiers; use provider `openai-compatible` with the right base URL + key. |

## Environment variables

| Var | Description | Default |
| --- | --- | --- |
| `PROVIDER` | `openrouter` \| `ollama` \| `openai` \| `anthropic` \| `openai-compatible` | `openrouter` |
| `MODEL` | Model id | `anthropic/claude-3.5-sonnet` |
| `API_KEY` | Provider API key (or `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) | — |
| `BASE_URL` | Override endpoint | per provider |
| `PORT` | Server port | `8787` |
| `CLAUDE_FREE_CWD` | Working directory tools operate in | current dir |

## Plugins

Add tools by dropping a module in `plugins/`:

```js
export default {
  name: "my-plugin",
  tools: [
    {
      name: "my_tool",
      description: "Does something useful.",
      parameters: { type: "object", properties: {} },
      async execute(args, ctx) {
        return `cwd is ${ctx.cwd}`;
      },
    },
  ],
};
```

Set `requiresApproval: true` on a tool to require user confirmation.

## Architecture

```
server/
  src/
    index.ts            HTTP + WebSocket server, serves web/dist
    config.ts           env + ~/.claude-free/config.json
    agents/loop.ts      the agent loop (LLM → tools → LLM)
    providers/          openai-compatible + anthropic adapters
    tools/              bash, read, write, edit, glob, grep, ls, webfetch
    plugins/loader.ts   dynamic plugin loader
web/
  src/
    App.tsx             layout
    useAgent.ts         WebSocket client + state
    components/         Markdown, ToolCard, SettingsPanel, ApprovalDialog
```

## Security

The agent can run arbitrary shell commands and edit files. Only run it locally, point it at a working directory you trust, and keep **auto-approve off** if you're unsure. In dev mode these tools run with your user's permissions.
