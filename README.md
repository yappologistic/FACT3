<p align="center">
  <img src="assets/prod/black-universal-1024.png" alt="FACT3 Code icon" width="128" height="128" />
</p>

# FACT3 Code

FACT3 Code is a desktop-focused "agent harness control surface" built as a UI-focused fork of T3 Code. The primary FACT3 experience is the Electron app.

Because it retains T3 Code's underlying server and protocol architecture, FACT3 Code remains compatible with the existing T3 web and mobile clients. Those clients are maintained and distributed by T3 Code; this repository does not publish separate FACT3 iOS or Android apps.

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, and OpenCode. If they're set up on your computer, FACT3 Code can control them.

## What's new in FACT3 Code

- **Live agent activity:** Follow thinking, tool calls, tasks, and parallel sub-agents from a compact activity pill, then open it for detailed progress, sub-agent output, model, and reasoning information.
- **Deep appearance customization:** Choose from polished built-in themes, import compatible editor themes, and tune provider accent colors with modern color controls.
- **A calmer, more cohesive interface:** Refined squircle menus, cleaner file and skill tags, chat scroll shadows, channel-specific app icons, and focused activity presentation keep complex agent work easy to scan.

## "Wait, what are you selling me?"

Nothing. We built FACT3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> FACT3 Code currently supports Codex, Claude, Cursor, Grok Build and OpenCode. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Run the Electron app from source

FACT3 Code does not currently publish prebuilt desktop releases. To run the Electron app, install [Node.js 24.13.1 or newer](https://nodejs.org/) and [Vite+](https://viteplus.dev/guide/), then run:

```bash
git clone https://github.com/yappologistic/FACT3.git
cd FACT3
vp i
vp run dev:desktop
```

The development runner builds the desktop entry, starts the renderer, and opens the Electron app with hot reload.

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Agent activity](./docs/user/agent-activity.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- Linux: [run FACT3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

FACT3 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
