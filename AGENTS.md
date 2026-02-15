# Repository Guidelines

## Project Structure
- `bin/`: the shipped CLI implementation (`bin/codex-claudecode-proxy.js`). Only this directory is published to npm (see `package.json#files`).
- `test/`: Node.js tests (`test/*.test.js`) using the built-in `node:test` runner.
- Docs/config: `README.md` (user-facing usage), `CLAUDE.md` (architecture + local side effects), `LICENSE`.

## Build, Test, and Development Commands
This project has no build step and no dependencies. Use Node.js (>= 18).

```bash
# CLI help / local smoke check
node bin/codex-claudecode-proxy.js help

# Run test suite
node --test

# Optional syntax check
node --check bin/codex-claudecode-proxy.js
```

For end-to-end flows, follow `README.md` (`install|start|stop|status|uninstall|purge`). Note: these commands can modify macOS LaunchAgents and files under your home directory.

## Coding Style & Naming Conventions
- ESM only (`"type": "module"`). Prefer built-in Node modules over new dependencies.
- Formatting: 2-space indentation, double quotes, semicolons; keep output/docs ASCII-only.
- Naming: `camelCase` for functions/vars, `UPPER_SNAKE_CASE` for constants.

## Testing Guidelines
- Framework: `node:test` + `node:assert/strict`.
- File naming: `test/*.test.js`.
- Tests should avoid touching real machine state; stub macOS tools (e.g. `launchctl`) and use a temporary `HOME` (see `test/non-interactive.test.js`).

## Commit & Pull Request Guidelines
- Commit subjects are short, imperative, and descriptive (examples in history: “Simplify installer…”, “Update README.md”).
- Version bumps use `package.json` + git tag `vX.Y.Z` (e.g. `v0.1.1`).
- PRs must include: what user-visible behavior changed, any filesystem/LaunchAgent side effects, and the test result (`node --test`). If changing install behavior, include macOS repro steps.

## Security & Configuration Tips
- Never commit or log tokens. The CLI reads `~/.codex/auth.json` and writes mirrored auth under `~/.cli-proxy-api/` with restrictive permissions.
- When developing, prefer `status`/tests over `install` unless you explicitly intend to modify local settings.
