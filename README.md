# codex-claudecode-proxy

An `npx` installer that sets up a local proxy (CLIProxyAPI) so Claude Code can reuse your existing Codex OAuth token (`~/.codex/auth.json`).

## Quick Start

```bash
npx -y codex-claudecode-proxy@latest --yes
```

After install:

```bash
source ~/.zshrc
claude
```

## What It Does

- Installs `CLIProxyAPI` binary to `~/.local/bin/cli-proxy-api`
- Writes `~/.cli-proxy-api/config.yaml`
  - Forces `reasoning.effort=xhigh` for `protocol=codex` and `model=gpt-*`
- Syncs token:
  - Source: `~/.codex/auth.json`
  - Target: `~/.cli-proxy-api/auths/codex-from-codex-cli.json`
- Registers LaunchAgents (auto start/restart):
  - `com.$USER.cli-proxy-api`
  - `com.$USER.cli-proxy-api-token-sync` (syncs on auth.json changes)
- Updates Claude Code settings in `~/.claude/settings.json`:
  - `ANTHROPIC_BASE_URL=http://127.0.0.1:8317`
  - Sets all model keys to `gpt-5.3-codex`
- Adds a `claude()` wrapper in `~/.zshrc`:
  - On `claude`, starts proxy (prints `[proxy][CANCEL]` if already running)

## Commands

```bash
npx -y codex-claudecode-proxy@latest          # install (interactive)
npx -y codex-claudecode-proxy@latest --yes    # install (non-interactive)
npx -y codex-claudecode-proxy@latest status
npx -y codex-claudecode-proxy@latest start
npx -y codex-claudecode-proxy@latest stop
npx -y codex-claudecode-proxy@latest uninstall
```

## Requirements

- macOS (uses LaunchAgents)
- Claude Code CLI (`claude`)
- Codex CLI logged in (must have `~/.codex/auth.json`)
