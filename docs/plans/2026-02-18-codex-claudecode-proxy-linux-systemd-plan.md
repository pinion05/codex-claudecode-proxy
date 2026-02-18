# codex-claudecode-proxy Linux(systemd) Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Ubuntu/WSL (Linux) support so `npx -y codex-claudecode-proxy` installs and runs the proxy using **systemd --user** with mac-level behavior (keepalive + auth.json watch/sync), while preserving existing macOS behavior.

**Architecture:** Keep OS-neutral parts shared (config generation, Claude settings updates, healthchecks). Add a Linux backend that manages **systemd user units** and replace mac-only token parsing (`plutil`) with a cross-platform Node token-sync script.

**Tech Stack:** Node.js (ESM, no deps), systemd user units via `systemctl --user`, GitHub Releases download via `fetch`.

---

## Task 0: Setup branch & docs (no behavior changes)

**Files:**
- Create: `docs/plans/2026-02-18-codex-claudecode-proxy-linux-systemd-design.md`
- Create: `docs/plans/2026-02-18-codex-claudecode-proxy-linux-systemd-plan.md`

**Step 1: Confirm branch is correct**

Run:
```bash
git status -sb
```
Expected: on a fresh v2 branch (e.g. `linux-systemd-v2`) based on `main`.

**Step 2: Commit docs**

Run:
```bash
git add docs/plans/
git commit -m "docs: add linux systemd design and implementation plan"
```

---

## Task 1: TDD — Add failing Linux install test scaffold

**Files:**
- Modify: `test/non-interactive.test.js`

**Step 1: Write failing test (Linux path)**
Add a test that runs `node bin/codex-claudecode-proxy.js install` on Linux and expects exit 0 **when a stub `systemctl` is present** and when `HOME` is a temp dir.

Test should assert at minimum:
- `~/.config/systemd/user/cli-proxy-api-linux.service` exists
- `~/.config/systemd/user/cli-proxy-api-token-sync-linux.path` exists
- `~/.cli-proxy-api/sync-codex-token.mjs` exists

**Step 2: Run test to verify it fails**

Run:
```bash
node --test
```
Expected on current code: FAIL because Linux install is not implemented / still mac-only.

**Step 3: Commit**

Run:
```bash
git add test/non-interactive.test.js
git commit -m "test: add failing linux systemd install expectations"
```

---

## Task 2: Allow package usage on Linux (unblock npx)

**Files:**
- Modify: `package.json`

**Step 1: Update OS allowlist**
Ensure `package.json` allows Linux alongside darwin (still blocks windows).

**Step 2: Add/adjust a test expectation (optional)**
If you add a test that calls `npm install`, keep it isolated; otherwise rely on earlier EBADPLATFORM repro.

**Step 3: Commit**

Run:
```bash
git add package.json
git commit -m "chore: allow linux platform"
```

---

## Task 3: Make token sync cross-platform (remove plutil dependency)

**Files:**
- Modify: `bin/codex-claudecode-proxy.js`

**Step 1: Write failing unit expectation in test (if not already)**
Test should verify the generated token-sync script is **Node-based** (`sync-codex-token.mjs`) not a `plutil` bash pipeline.

**Step 2: Implement minimal token sync generator**
In `bin/codex-claudecode-proxy.js`, generate:
- `~/.cli-proxy-api/sync-codex-token.mjs`
that:
- reads `${HOME}/.codex/auth.json`
- extracts `tokens.access_token`, `tokens.refresh_token`, `tokens.id_token`, `tokens.account_id`, `last_refresh`
- writes `${HOME}/.cli-proxy-api/auths/codex-from-codex-cli.json`
- sets mode 0600 on output

**Step 3: Update macOS flow to execute Node script**
Wherever token sync is wired (launchd), invoke it using `process.execPath` so PATH issues are avoided.

**Step 4: Run tests**
Run:
```bash
node --test
```
Expected: still failing overall until Linux backend lands, but token-sync specific assertions should pass.

**Step 5: Commit**
```bash
git add bin/codex-claudecode-proxy.js
git commit -m "refactor: use node token sync script"
```

---

## Task 4: Generalize CLIProxyAPI download assets for Linux

**Files:**
- Modify: `bin/codex-claudecode-proxy.js`

**Step 1: Write failing test expectation (optional)**
If feasible, add a test that asserts the suffix selection uses `linux_amd64|linux_arm64` on Linux.

**Step 2: Implement platform-aware suffix selection**
- macOS: `darwin_${arch}.tar.gz`
- Linux: `linux_${arch}.tar.gz`

**Step 3: Run check**
Run:
```bash
node --check bin/codex-claudecode-proxy.js
```
Expected: success.

**Step 4: Commit**
```bash
git add bin/codex-claudecode-proxy.js
git commit -m "feat: download CLIProxyAPI linux artifacts"
```

---

## Task 5: Implement Linux systemd --user backend (install/start/stop/status/uninstall/purge)

**Files:**
- Modify: `bin/codex-claudecode-proxy.js`
- Modify: `test/non-interactive.test.js`

**Step 1: Add systemd availability check**
In Linux flows, verify `systemctl --user` works.
- If not available: exit non-zero with WSL/systemd guidance.

**Step 2: Implement unit file generation**
Write to `~/.config/systemd/user/`:
- `cli-proxy-api-linux.service`
- `cli-proxy-api-token-sync-linux.service`
- `cli-proxy-api-token-sync-linux.path`

**Step 3: Wire systemctl operations**
Install should:
- write units
- `systemctl --user daemon-reload`
- `systemctl --user enable --now cli-proxy-api-token-sync-linux.path`
- `systemctl --user enable --now cli-proxy-api-linux.service`

Start/stop/uninstall/purge should do the obvious enable/disable/stop and cleanup.

**Step 4: Make the Linux test pass using a stub `systemctl`**
In tests, create a stub `systemctl` in PATH that no-ops and returns 0.

**Step 5: Run tests**
Run:
```bash
node --test
```
Expected: PASS.

**Step 6: Commit**
```bash
git add bin/codex-claudecode-proxy.js test/non-interactive.test.js
git commit -m "feat: add linux systemd user-unit support"
```

---

## Task 6: Docs — Update README with Linux instructions & WSL systemd note

**Files:**
- Modify: `README.md`

**Step 1: Add Linux requirements section**
- Ubuntu/WSL supported
- systemd required
- note: runs in user session by default; optional linger command documented

**Step 2: Commit**
```bash
git add README.md
git commit -m "docs: add linux and wsl setup instructions"
```

---

## Task 7: Final verification + PR

**Step 1: Full local verification**
Run:
```bash
node --check bin/codex-claudecode-proxy.js
node --test
```
Expected:
- check: success
- tests: all pass

**Step 2: Push and open PR**
Run:
```bash
git push -u origin linux-systemd-v2
```
Then open PR to `main`.

---

## Execution choice
Plan complete.

Two execution options:
1) **Subagent-Driven (this session)** — REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (implementer → spec review → quality review per task)
2) **Parallel Session** — run the plan in a separate session using `superpowers:executing-plans`

Which one now? (너는 subagent-driven 원했지)