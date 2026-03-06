# codex-claudecode-proxy
[![DeepWiki](https://img.shields.io/badge/DeepWiki-pinion05%2Fcodex--claudecode--proxy-blue.svg?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAyCAYAAAAnWDnqAAAAAXNSR0IArs4c6QAAA05JREFUaEPtmUtyEzEQhtWTQyQLHNak2AB7ZnyXZMEjXMGeK/AIi+QuHrMnbChYY7MIh8g01fJoopFb0uhhEqqcbWTp06/uv1saEDv4O3n3dV60RfP947Mm9/SQc0ICFQgzfc4CYZoTPAswgSJCCUJUnAAoRHOAUOcATwbmVLWdGoH//PB8mnKqScAhsD0kYP3j/Yt5LPQe2KvcXmGvRHcDnpxfL2zOYJ1mFwrryWTz0advv1Ut4CJgf5uhDuDj5eUcAUoahrdY/56ebRWeraTjMt/00Sh3UDtjgHtQNHwcRGOC98BJEAEymycmYcWwOprTgcB6VZ5JK5TAJ+fXGLBm3FDAmn6oPPjR4rKCAoJCal2eAiQp2x0vxTPB3ALO2CRkwmDy5WohzBDwSEFKRwPbknEggCPB/imwrycgxX2NzoMCHhPkDwqYMr9tRcP5qNrMZHkVnOjRMWwLCcr8ohBVb1OMjxLwGCvjTikrsBOiA6fNyCrm8V1rP93iVPpwaE+gO0SsWmPiXB+jikdf6SizrT5qKasx5j8ABbHpFTx+vFXp9EnYQmLx02h1QTTrl6eDqxLnGjporxl3NL3agEvXdT0WmEost648sQOYAeJS9Q7bfUVoMGnjo4AZdUMQku50McDcMWcBPvr0SzbTAFDfvJqwLzgxwATnCgnp4wDl6Aa+Ax283gghmj+vj7feE2KBBRMW3FzOpLOADl0Isb5587h/U4gGvkt5v60Z1VLG8BhYjbzRwyQZemwAd6cCR5/XFWLYZRIMpX39AR0tjaGGiGzLVyhse5C9RKC6ai42ppWPKiBagOvaYk8lO7DajerabOZP46Lby5wKjw1HCRx7p9sVMOWGzb/vA1hwiWc6jm3MvQDTogQkiqIhJV0nBQBTU+3okKCFDy9WwferkHjtxib7t3xIUQtHxnIwtx4mpg26/HfwVNVDb4oI9RHmx5WGelRVlrtiw43zboCLaxv46AZeB3IlTkwouebTr1y2NjSpHz68WNFjHvupy3q8TFn3Hos2IAk4Ju5dCo8B3wP7VPr/FGaKiG+T+v+TQqIrOqMTL1VdWV1DdmcbO8KXBz6esmYWYKPwDL5b5FA1a0hwapHiom0r/cKaoqr+27/XcrS5UwSMbQAAAABJRU5ErkJggg==)](https://deepwiki.com/pinion05/codex-claudecode-proxy)

[![NPM](https://nodei.co/npm/codex-claudecode-proxy.svg)](https://nodei.co/npm/codex-claudecode-proxy/)


A local proxy installer CLI that translates the OpenAI OAuth API into a Claude-compatible API.

## One-Liner

```bash
npx -y codex-claudecode-proxy
```

## Requirements

### macOS

- Claude Code is installed
- You are logged in to Codex CLI

### Linux (Ubuntu / WSL2)

- Ubuntu (including WSL2 Ubuntu) is supported.
- **systemd is required** — `systemctl --user` must work.
  - Linux environments without systemd are not supported (the installer fails fast with guidance).
- Runs in your **user session** as **systemd user units** (no sudo; installs into your home directory).
  - Optional: keep services running when you log out:
    ```bash
    loginctl enable-linger $USER
    ```
- Installed user units on Linux:
  - `cli-proxy-api-linux.service`
  - `cli-proxy-api-token-sync-linux.service`
  - `cli-proxy-api-token-sync-linux.path`
- Token sync watches `~/.codex/auth.json` and mirrors the token into `~/.cli-proxy-api/auths/...`.

#### WSL2: enable systemd

1) Create or edit `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

2) From **Windows PowerShell**, restart WSL:

```powershell
wsl --shutdown
```

3) Re-open your WSL distro and confirm:

```bash
systemctl --user status
```

#### Troubleshooting (Linux)

- Verify the systemd **user** session is available:
  ```bash
  systemctl --user status
  ```
- Check installed units:
  ```bash
  systemctl --user status cli-proxy-api-linux.service
  systemctl --user status cli-proxy-api-token-sync-linux.service
  systemctl --user status cli-proxy-api-token-sync-linux.path
  ```
- View logs:
  ```bash
  journalctl --user -u cli-proxy-api-linux.service -n 100 --no-pager
  ```
- If `systemctl --user` fails (e.g. "Failed to connect to bus"), your environment doesn't have a systemd user session.
  - On WSL2, enable systemd via `/etc/wsl.conf` (above) and run `wsl --shutdown`.
  - On non-systemd Linux environments, this installer is unsupported.

## Model -> Reasoning Effort Routing

This installer configures Claude Code's Opus/Sonnet/Haiku tiers so that:

- The visible model names encode the desired reasoning effort:
  - Opus: `gpt-5.4(xhigh)`
  - Sonnet: `gpt-5.4(high)`
  - Haiku: `gpt-5.4(medium)`
- CLIProxyAPI rewrites all tier requests to call the same upstream model (`gpt-5.4`),
  while setting `reasoning.effort` to `xhigh` / `high` / `medium` based on the tier.

In other words: tier selection controls reasoning level, not the upstream model.

## Commands

```bash
# Install (safe to re-run)
npx -y codex-claudecode-proxy

# Status
npx -y codex-claudecode-proxy status

# Start/stop manually
npx -y codex-claudecode-proxy start
npx -y codex-claudecode-proxy stop

# Uninstall: stop background services and restore Claude Code settings
npx -y codex-claudecode-proxy uninstall

# Purge: uninstall + remove installed files
npx -y codex-claudecode-proxy purge
```

## Integrity / Safety

- Claude Code settings are configured automatically, and a backup is created before changes.
- Running `uninstall` removes the proxy-related Claude settings and restores the original behavior.

## License

MIT
