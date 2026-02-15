# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is
- `codex-claudecode-proxy` is an `npx`-run installer that sets up a local proxy (CLIProxyAPI) so Claude Code can reuse the Codex OAuth token from `~/.codex/auth.json`.
  - Overview: `README.md:1-4`
- macOS-only: uses LaunchAgents (`launchctl`).
  - Platform check: `bin/codex-claudecode-proxy.js:592-595`

## Repo layout (where to look)
- `bin/codex-claudecode-proxy.js` is the entire implementation and CLI entrypoint.
  - `package.json` bin mapping: `package.json:14-16`
  - Only `bin/` is shipped to npm: `package.json:18-20`
- `README.md` documents user-facing usage and machine-side effects.

## Common dev commands
This repo has **no** configured build/lint/typecheck/test scripts (and no dependencies).
- Node requirement: `node >= 18` (`package.json:21-23`).

Local smoke checks (do not install anything):
- Show CLI usage:
  - `node bin/codex-claudecode-proxy.js help` (`bin/codex-claudecode-proxy.js:29-49`)
- Check proxy status (healthcheck + launchctl print on macOS):
  - `node bin/codex-claudecode-proxy.js status` (`bin/codex-claudecode-proxy.js:721-732`)

To exercise the full flows (`install|start|stop|uninstall|purge`), follow the commands in `README.md:74-98`.

## Architecture (big picture)
**Entry + routing**
- Argument parsing + defaults: `parseArgs()` (`bin/codex-claudecode-proxy.js:51-99`)
  - Defaults: port `8317` and model `gpt-5.3-codex` (`bin/codex-claudecode-proxy.js:9-10`)
- Entrypoint: `main()` (`bin/codex-claudecode-proxy.js:784-816`) routes to `installFlow`, `startFlow`, `stopFlow`, `statusFlow`, `uninstallFlow`.

**Install flow (macOS)** (`bin/codex-claudecode-proxy.js:592-685`)
1. Requires `~/.codex/auth.json` (Codex CLI login) (`bin/codex-claudecode-proxy.js:616-619`).
2. Downloads latest CLIProxyAPI GitHub release asset and installs the binary to `~/.local/bin/cli-proxy-api`.
   - Release fetch + extraction: `bin/codex-claudecode-proxy.js:437-471`
3. Writes proxy config `~/.cli-proxy-api/config.yaml` which forces `"reasoning.effort": "xhigh"` for `protocol: "codex"` + `model: gpt-*`.
   - YAML generation: `bin/codex-claudecode-proxy.js:336-348`
4. Generates a token sync script `~/.cli-proxy-api/sync-codex-token.sh` and runs it once.
   - Script contents: `bin/codex-claudecode-proxy.js:350-392`
   - The script uses macOS `plutil` to extract tokens from `~/.codex/auth.json` and writes a mirror JSON under `~/.cli-proxy-api/auths/` with `chmod 600`.
5. Creates and (re)loads two LaunchAgents:
   - Proxy service (KeepAlive): `buildPlistProxy()` (`bin/codex-claudecode-proxy.js:417-435`)
   - Token sync watcher (WatchPaths): `buildPlistSync()` (`bin/codex-claudecode-proxy.js:394-415`)
   - Reload sequence: `bin/codex-claudecode-proxy.js:649-656`
6. Waits for health via `GET http://127.0.0.1:$PORT/v1/models`.
   - Healthcheck: `bin/codex-claudecode-proxy.js:211-221`
7. Optionally updates Claude Code settings at `~/.claude/settings.json` to route Claude Code through the local proxy and set model env keys.
   - Update: `bin/codex-claudecode-proxy.js:473-501`
8. Optionally injects a `claude()` wrapper block into `~/.zshrc` that ensures the proxy is running, then executes the real `claude` with `--dangerously-skip-permissions`.
   - Wrapper block: `bin/codex-claudecode-proxy.js:246-313`
9. Verifies the proxy enforces `reasoning.effort=xhigh` by calling `POST /v1/responses` and inspecting the response JSON.
   - Verification request: `bin/codex-claudecode-proxy.js:223-244`

**Other flows**
- `startFlow` bootstraps/kickstarts LaunchAgents and waits healthy: `bin/codex-claudecode-proxy.js:687-708`
- `stopFlow` bootouts both LaunchAgents: `bin/codex-claudecode-proxy.js:710-719`
- `uninstallFlow` removes LaunchAgents + (optionally) removes the `~/.zshrc` block; `purge` additionally deletes proxy files + cleans Claude settings: `bin/codex-claudecode-proxy.js:734-782`

## Safety / side effects (important for local testing)
This CLI is intentionally invasive and changes user-machine state:
- Downloads an external executable (CLIProxyAPI) and installs it to `~/.local/bin/cli-proxy-api`.
- Writes under `~/.cli-proxy-api/` (config, logs, token mirror, sync script).
- Creates LaunchAgents under `~/Library/LaunchAgents/`.
- Optionally edits `~/.claude/settings.json` and `~/.zshrc`.

Prefer `help`/`status` while developing unless you explicitly want to modify machine state.
