# codex-claudecode-proxy

An `npx` installer that sets up a local proxy (CLIProxyAPI) so Claude Code can reuse your existing Codex OAuth token (`~/.codex/auth.json`).

## TL;DR (One-Liner)

If this package is published on npm:

```bash
npx -y codex-claudecode-proxy@latest --yes
```

If you are running directly from GitHub (before npm publish):

```bash
npx -y github:pinion05/codex-claudecode-proxy --yes
```

Then:

```bash
source ~/.zshrc
claude
```

## Requirements

- macOS (uses LaunchAgents)
- Claude Code CLI (`claude`) installed
- Codex CLI logged in (must have `~/.codex/auth.json`)

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

## Common Workflows

- Install / re-run install (idempotent):

  ```bash
  npx -y codex-claudecode-proxy@latest --yes
  ```

- Check proxy status:

  ```bash
  npx -y codex-claudecode-proxy@latest status
  ```

- Start / stop proxy manually:

  ```bash
  npx -y codex-claudecode-proxy@latest start
  npx -y codex-claudecode-proxy@latest stop
  ```

- Uninstall vs purge:
  - `uninstall`: removes LaunchAgents + removes `~/.zshrc` wrapper block (keeps proxy files).
  - `purge`: uninstall + deletes `~/.cli-proxy-api` + deletes `~/.local/bin/cli-proxy-api` + cleans proxy keys from `~/.claude/settings.json`.

## Commands

```bash
npx -y codex-claudecode-proxy@latest          # install (interactive)
npx -y codex-claudecode-proxy@latest --yes    # install (non-interactive)
npx -y codex-claudecode-proxy@latest status
npx -y codex-claudecode-proxy@latest start
npx -y codex-claudecode-proxy@latest stop
npx -y codex-claudecode-proxy@latest uninstall
npx -y codex-claudecode-proxy@latest purge --yes
```

## Options

- `--yes` / `-y`: non-interactive mode (recommended for one-liner installs)
- `--port <n>`: proxy port (default: `8317`)
- `--model <name>`: model to set in Claude Code settings (default: `gpt-5.3-codex`)
- `--no-zshrc`: do not touch `~/.zshrc`
- `--no-claude-settings`: do not touch `~/.claude/settings.json`

Example:

```bash
npx -y codex-claudecode-proxy@latest --yes --port 8317 --model gpt-5.3-codex
```

## Files Created / Modified

- Proxy binary:
  - `~/.local/bin/cli-proxy-api`
- Proxy config:
  - `~/.cli-proxy-api/config.yaml`
- Token mirror for proxy:
  - `~/.cli-proxy-api/auths/codex-from-codex-cli.json`
- Logs:
  - `~/.cli-proxy-api/cli-proxy-api.log`
  - `~/.cli-proxy-api/token-sync.log`
- LaunchAgents:
  - `~/Library/LaunchAgents/com.$USER.cli-proxy-api.plist`
  - `~/Library/LaunchAgents/com.$USER.cli-proxy-api-token-sync.plist`
- Claude Code settings:
  - `~/.claude/settings.json` (backed up with `settings.json.backup.<timestamp>`)
- Zsh wrapper:
  - `~/.zshrc` (backed up with `.zshrc.backup.<timestamp>`)

## Troubleshooting

- `missing ~/.codex/auth.json`:
  - You must login via Codex CLI first (so the OAuth token exists).

- Proxy does not become healthy:
  - Check: `~/.cli-proxy-api/cli-proxy-api.log`
  - Also confirm the port is free (default `8317`). If not, use `--port`.

- `claude` command not found:
  - Install Claude Code CLI first, then re-run install.

## Security Notes

- This tool reads `~/.codex/auth.json` and writes a local mirror under `~/.cli-proxy-api/auths/` for CLIProxyAPI to use.
- The mirror file is written with `chmod 600`.
