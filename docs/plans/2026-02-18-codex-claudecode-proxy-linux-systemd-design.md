# codex-claudecode-proxy Linux(systemd) Support — Design

## Goal
Enable **Ubuntu + WSL (Linux)** users to run a single command:

```bash
npx -y codex-claudecode-proxy
```

…and get the same “mac-level” experience:
- local proxy runs in background with keepalive/restart
- Codex OAuth token automatically synced when `~/.codex/auth.json` changes
- Claude Code is configured to route to the local proxy

## Non-Goals / Scope boundaries
- Linux without `systemd` + `systemctl --user` is **not supported**.
  - The installer must fail fast with a clear message and WSL guidance.
- No default “boot without login” setup (linger). Installer should **not** require sudo.
  - Optional linger instructions may be documented separately.

## Architecture
### Cross-platform core
Shared logic stays OS-neutral:
- write proxy config: `~/.cli-proxy-api/config.yaml`
- healthcheck `/v1/models`
- verify tier → `reasoning.effort` routing via `/v1/responses`
- update `~/.claude/settings.json` (backup + atomic write)
- download CLIProxyAPI from GitHub Releases matching `platform + arch`

### Token sync (cross-platform)
Replace mac-only `plutil` extraction with a generated Node script:
- generate `~/.cli-proxy-api/sync-codex-token.mjs`
- read JSON from `~/.codex/auth.json`
- write `~/.cli-proxy-api/auths/codex-from-codex-cli.json` with `chmod 600`

### Linux service management (systemd user units)
Installer writes units to `~/.config/systemd/user/`:
- `cli-proxy-api-linux.service` (proxy keepalive)
- `cli-proxy-api-token-sync-linux.service` (oneshot token sync)
- `cli-proxy-api-token-sync-linux.path` (watch `~/.codex/auth.json` and trigger sync)

Installer then runs:
- `systemctl --user daemon-reload`
- `systemctl --user enable --now ...` (path + proxy)

### WSL specifics
If Linux platform is detected but `systemctl --user` is unavailable, fail with:
- explanation that WSL needs `systemd=true`
- minimal steps: edit `/etc/wsl.conf`, then `wsl --shutdown`

## Acceptance criteria
- On Ubuntu/WSL with systemd enabled:
  - `npx -y codex-claudecode-proxy install` exits 0
  - proxy responds `200` at `http://127.0.0.1:<port>/v1/models`
  - changing `~/.codex/auth.json` triggers the token sync to update the mirrored auth file
- On Linux without systemd:
  - `install` exits non-zero with a clear, actionable message
