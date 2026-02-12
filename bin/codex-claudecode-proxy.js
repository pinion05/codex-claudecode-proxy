#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_PORT = 8317;
const DEFAULT_MODEL = "gpt-5.3-codex";

function nowTs() {
  return Date.now().toString();
}

function log(msg) {
  console.log(`[codex-claudecode-proxy] ${msg}`);
}

function warn(msg) {
  console.error(`[codex-claudecode-proxy][WARN] ${msg}`);
}

function fail(msg, code = 1) {
  console.error(`[codex-claudecode-proxy][FAIL] ${msg}`);
  process.exit(code);
}

function usage(code = 0) {
  const txt = `Usage:
  codex-claudecode-proxy [command] [--yes] [--port <n>] [--model <name>] [--no-zshrc] [--no-claude-settings]

Commands:
  install      Install + configure + start (default)
  start        Start proxy LaunchAgent
  stop         Stop proxy + sync LaunchAgents
  status       Show status
  uninstall    Remove LaunchAgents + zshrc block (does not delete binaries by default)
  help         Show this help

Examples:
  npx -y codex-claudecode-proxy@latest --yes
  npx -y codex-claudecode-proxy@latest status
`;
  console.log(txt);
  process.exit(code);
}

function parseArgs(argv) {
  const args = [...argv];
  const out = {
    command: "install",
    yes: false,
    port: DEFAULT_PORT,
    model: DEFAULT_MODEL,
    noZshrc: false,
    noClaudeSettings: false,
  };

  if (args.length > 0 && !args[0].startsWith("-")) {
    out.command = args.shift();
  }

  while (args.length > 0) {
    const a = args.shift();
    if (a === "--help" || a === "-h" || a === "help") return { ...out, command: "help" };
    if (a === "--yes" || a === "-y") {
      out.yes = true;
      continue;
    }
    if (a === "--port") {
      const v = args.shift();
      if (!v) fail("--port requires a value");
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0 || n > 65535) fail(`invalid --port: ${v}`);
      out.port = n;
      continue;
    }
    if (a === "--model") {
      const v = args.shift();
      if (!v) fail("--model requires a value");
      out.model = v;
      continue;
    }
    if (a === "--no-zshrc") {
      out.noZshrc = true;
      continue;
    }
    if (a === "--no-claude-settings") {
      out.noClaudeSettings = true;
      continue;
    }
    fail(`unknown arg: ${a}`);
  }

  return out;
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function writeFileAtomic(p, content, mode) {
  const dir = path.dirname(p);
  ensureDir(dir);
  const tmp = `${p}.tmp.${process.pid}.${nowTs()}`;
  fs.writeFileSync(tmp, content, "utf8");
  if (mode != null) fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, p);
}

function backupFile(p) {
  if (!exists(p)) return null;
  const bak = `${p}.backup.${nowTs()}`;
  fs.copyFileSync(p, bak);
  return bak;
}

function run(cmd, args, opts = {}) {
  const {
    cwd,
    allowFail = false,
    captureStdout = true,
    captureStderr = true,
  } = opts;

  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: [
      "ignore",
      captureStdout ? "pipe" : "inherit",
      captureStderr ? "pipe" : "inherit",
    ],
  });

  if (!allowFail && (r.error || r.status !== 0)) {
    const msg = [
      `${cmd} ${args.join(" ")}`,
      r.error ? String(r.error) : "",
      r.stdout ? `stdout:\n${r.stdout}` : "",
      r.stderr ? `stderr:\n${r.stderr}` : "",
    ].filter(Boolean).join("\n");
    fail(msg);
  }
  return r;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "codex-claudecode-proxy" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} (${url})`);
  }
  return await res.json();
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "codex-claudecode-proxy" },
  });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`);
  ensureDir(path.dirname(destPath));
  const tmp = `${destPath}.tmp.${process.pid}.${nowTs()}`;
  const ab = await res.arrayBuffer();
  fs.writeFileSync(tmp, Buffer.from(ab));
  fs.renameSync(tmp, destPath);
}

function findFileRecursive(rootDir, names) {
  /** @type {string[]} */
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (it.isFile() && names.includes(it.name)) {
        return p;
      }
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function proxyHealthcheck(port) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function verifyReasoningEffort(port, model) {
  for (let i = 0; i < 6; i += 1) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input: "say pong" }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const json = await res.json();
      const effort = json?.reasoning?.effort;
      if (effort === "xhigh") return true;
      await sleep(1000);
    } catch {
      await sleep(1000);
    }
  }
  return false;
}

function zshrcBlock({ port }) {
  return `

# >>> codex-cli-proxy auto-start >>>
unalias claude 2>/dev/null || true

_claude_proxy_healthcheck() {
  curl -fsS -m 2 "http://127.0.0.1:${port}/v1/models" >/dev/null 2>&1
}

_claude_ensure_proxy() {
  local label="com.\${USER}.cli-proxy-api"
  local plist="\${HOME}/Library/LaunchAgents/\${label}.plist"
  local log_file="\${HOME}/.cli-proxy-api/cli-proxy-api.log"
  local uid
  uid="$(id -u)"

  if _claude_proxy_healthcheck; then
    echo "[proxy][CANCEL] already running"
    return 0
  fi

  if launchctl print "gui/\${uid}/\${label}" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/\${uid}/\${label}" >/dev/null 2>&1 || true
  elif [[ -f "$plist" ]]; then
    launchctl bootstrap "gui/\${uid}" "$plist" >/dev/null 2>&1 || true
    launchctl kickstart -k "gui/\${uid}/\${label}" >/dev/null 2>&1 || true
  elif [[ -x "\${HOME}/.local/bin/cli-proxy-api" ]]; then
    mkdir -p "\${HOME}/.cli-proxy-api"
    nohup "\${HOME}/.local/bin/cli-proxy-api" --config "\${HOME}/.cli-proxy-api/config.yaml" >>"\${log_file}" 2>&1 &
  else
    echo "[proxy][FAIL] cli-proxy-api binary not found"
    return 1
  fi

  local i
  for i in {1..20}; do
    if _claude_proxy_healthcheck; then
      echo "[proxy][SUCCESS] started"
      return 0
    fi
    sleep 0.25
  done

  echo "[proxy][FAIL] failed to start (check \${log_file})"
  return 1
}

claude() {
  _claude_ensure_proxy || true

  local claude_bin
  claude_bin="$(whence -p claude 2>/dev/null || true)"
  if [[ -z "\${claude_bin}" && -x "\${HOME}/.local/bin/claude" ]]; then
    claude_bin="\${HOME}/.local/bin/claude"
  fi
  if [[ -z "\${claude_bin}" ]]; then
    echo "[claude][FAIL] claude binary not found"
    return 127
  fi

  "\${claude_bin}" --dangerously-skip-permissions "$@"
}

alias claude-p='claude'
# <<< codex-cli-proxy auto-start <<<
`.trimStart();
}

function removeZshrcBlock(s) {
  const start = "# >>> codex-cli-proxy auto-start >>>";
  const end = "# <<< codex-cli-proxy auto-start <<<";
  while (true) {
    const i = s.indexOf(start);
    if (i === -1) break;
    const j = s.indexOf(end, i);
    if (j === -1) break;
    s = s.slice(0, i) + s.slice(j + end.length);
  }

  // Remove simple aliases if present.
  s = s.split("\n").filter((line) => {
    if (line.startsWith("alias claude=")) return false;
    if (line.startsWith("alias claude-p=")) return false;
    return true;
  }).join("\n");

  return s.replace(/\n{3,}/g, "\n\n");
}

function proxyConfigYaml({ port }) {
  return `port: ${port}
auth-dir: "~/.cli-proxy-api/auths"

payload:
  override:
    - models:
        - name: "gpt-*"
          protocol: "codex"
      params:
        "reasoning.effort": "xhigh"
`;
}

function tokenSyncScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

SRC="\${1:-$HOME/.codex/auth.json}"
DST="\${2:-$HOME/.cli-proxy-api/auths/codex-from-codex-cli.json}"

if [[ ! -f "\${SRC}" ]]; then
  echo "missing \${SRC} (Codex CLI login required)" >&2
  exit 1
fi

access_token="$(plutil -extract tokens.access_token raw -o - "\${SRC}" 2>/dev/null || true)"
if [[ -z "\${access_token}" ]]; then
  echo "tokens.access_token missing in \${SRC}" >&2
  exit 1
fi

id_token="$(plutil -extract tokens.id_token raw -o - "\${SRC}" 2>/dev/null || true)"
refresh_token="$(plutil -extract tokens.refresh_token raw -o - "\${SRC}" 2>/dev/null || true)"
account_id="$(plutil -extract tokens.account_id raw -o - "\${SRC}" 2>/dev/null || true)"
last_refresh="$(plutil -extract last_refresh raw -o - "\${SRC}" 2>/dev/null || true)"

mkdir -p "$(dirname "\${DST}")"

cat > "\${DST}.tmp" <<JSON
{
  "access_token": "\${access_token}",
  "account_id": "\${account_id}",
  "disabled": false,
  "email": "",
  "expired": "",
  "id_token": "\${id_token}",
  "last_refresh": "\${last_refresh}",
  "refresh_token": "\${refresh_token}",
  "type": "codex"
}
JSON

mv "\${DST}.tmp" "\${DST}"
chmod 600 "\${DST}"
`;
}

function buildPlistSync({ labelSync, syncScriptPath, homeDir, tokenSyncLog }) {
  const authJsonPath = path.join(homeDir, ".codex", "auth.json");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${labelSync}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>${syncScriptPath}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>WatchPaths</key>
  <array>
    <string>${authJsonPath}</string>
  </array>
  <key>StandardOutPath</key><string>${tokenSyncLog}</string>
  <key>StandardErrorPath</key><string>${tokenSyncLog}</string>
</dict></plist>
`;
}

function buildPlistProxy({ labelProxy, proxyBin, configFile, homeDir, proxyLog }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${labelProxy}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${proxyBin}</string>
    <string>--config</string>
    <string>${configFile}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>${homeDir}</string>
  <key>StandardOutPath</key><string>${proxyLog}</string>
  <key>StandardErrorPath</key><string>${proxyLog}</string>
</dict></plist>
`;
}

async function installCliProxyApiBinary({ proxyBin }) {
  if (exists(proxyBin)) {
    log(`CLIProxyAPI already installed: ${proxyBin}`);
    return;
  }

  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null;
  if (!arch) fail(`unsupported architecture: ${process.arch}`);

  ensureDir(path.dirname(proxyBin));

  log("Downloading CLIProxyAPI release from GitHub...");
  const rel = await fetchJson("https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest");
  const suffix = `darwin_${arch}.tar.gz`;
  const asset = (rel.assets || []).find((a) => typeof a?.name === "string" && a.name.includes(suffix));
  if (!asset?.browser_download_url) {
    fail(`could not find asset containing: ${suffix}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-claudecode-proxy-"));
  const tarball = path.join(tmpDir, "cli-proxy-api.tar.gz");
  await downloadToFile(asset.browser_download_url, tarball);

  log("Extracting tarball...");
  run("tar", ["-xzf", tarball, "-C", tmpDir]);

  const found = findFileRecursive(tmpDir, ["cli-proxy-api", "CLIProxyAPI"]);
  if (!found) fail("failed to locate extracted binary");

  fs.copyFileSync(found, proxyBin);
  fs.chmodSync(proxyBin, 0o755);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  log(`Installed: ${proxyBin}`);
}

function updateClaudeSettings({ claudeSettingsPath, port, model }) {
  ensureDir(path.dirname(claudeSettingsPath));
  if (!exists(claudeSettingsPath)) {
    writeFileAtomic(claudeSettingsPath, "{}\n", 0o600);
  }

  backupFile(claudeSettingsPath);

  let json;
  try {
    json = JSON.parse(readText(claudeSettingsPath));
  } catch {
    fail(`failed to parse JSON: ${claudeSettingsPath}`);
  }

  if (!json || typeof json !== "object") json = {};
  if (!json.env || typeof json.env !== "object") json.env = {};

  json.model = model;
  json.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  json.env.ANTHROPIC_AUTH_TOKEN = "sk-ant-proxy-local";
  json.env.ANTHROPIC_MODEL = model;
  json.env.ANTHROPIC_SMALL_FAST_MODEL = model;
  json.env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
  json.env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
  json.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model;

  writeFileAtomic(claudeSettingsPath, `${JSON.stringify(json, null, 2)}\n`, 0o600);
}

function updateZshrc({ zshrcPath, port }) {
  ensureDir(path.dirname(zshrcPath));
  const mode = exists(zshrcPath) ? (fs.statSync(zshrcPath).mode & 0o777) : 0o600;
  if (!exists(zshrcPath)) writeFileAtomic(zshrcPath, "", mode);

  backupFile(zshrcPath);

  const prev = readText(zshrcPath);
  const cleaned = removeZshrcBlock(prev);
  const next = `${cleaned.trimEnd()}\n${zshrcBlock({ port })}\n`;
  writeFileAtomic(zshrcPath, next, mode);
}

function getUsername() {
  // Prefer $USER for consistency with LaunchAgent labels.
  if (process.env.USER && process.env.USER.trim()) return process.env.USER.trim();
  return os.userInfo().username;
}

function getUid() {
  const r = run("id", ["-u"]);
  return Number(String(r.stdout || "").trim());
}

function launchctlBootout(uid, label) {
  run("launchctl", ["bootout", `gui/${uid}/${label}`], { allowFail: true });
}

function launchctlBootstrap(uid, plistPath) {
  run("launchctl", ["bootstrap", `gui/${uid}`, plistPath], { allowFail: true });
}

function launchctlKickstart(uid, label) {
  run("launchctl", ["kickstart", "-k", `gui/${uid}/${label}`], { allowFail: true });
}

function launchctlPrint(uid, label) {
  const r = run("launchctl", ["print", `gui/${uid}/${label}`], { allowFail: true });
  return r.status === 0;
}

async function waitForHealthy(port, msTotal = 8000) {
  const started = Date.now();
  while (Date.now() - started < msTotal) {
    if (await proxyHealthcheck(port)) return true;
    await sleep(250);
  }
  return false;
}

function promptYesNo(question) {
  if (!process.stdin.isTTY) return false;
  const r = spawnSync("/bin/bash", ["-lc", `read -r -p ${JSON.stringify(question)} ans; echo "$ans"`], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  });
  const ans = String(r.stdout || "").trim().toLowerCase();
  return ans === "y" || ans === "yes";
}

async function installFlow(opts) {
  if (process.platform !== "darwin") {
    fail("macOS only (LaunchAgents 기반 설치).");
  }

  const homeDir = os.homedir();
  const username = getUsername();
  const uid = getUid();

  const proxyDir = path.join(homeDir, ".cli-proxy-api");
  const authDir = path.join(proxyDir, "auths");
  const configFile = path.join(proxyDir, "config.yaml");
  const syncScriptPath = path.join(proxyDir, "sync-codex-token.sh");
  const proxyBin = path.join(homeDir, ".local", "bin", "cli-proxy-api");
  const proxyLog = path.join(proxyDir, "cli-proxy-api.log");
  const tokenSyncLog = path.join(proxyDir, "token-sync.log");
  const claudeSettingsPath = path.join(homeDir, ".claude", "settings.json");
  const zshrcPath = path.join(homeDir, ".zshrc");

  const labelProxy = `com.${username}.cli-proxy-api`;
  const labelSync = `com.${username}.cli-proxy-api-token-sync`;
  const plistProxy = path.join(homeDir, "Library", "LaunchAgents", `${labelProxy}.plist`);
  const plistSync = path.join(homeDir, "Library", "LaunchAgents", `${labelSync}.plist`);

  const codexAuth = path.join(homeDir, ".codex", "auth.json");
  if (!exists(codexAuth)) {
    fail(`missing ${codexAuth} (Codex CLI login required)`);
  }

  if (!opts.yes) {
    log("아래 변경을 수행합니다:");
    log(`- CLIProxyAPI 설치: ${proxyBin}`);
    log(`- LaunchAgents: ${plistProxy}, ${plistSync}`);
    log(`- Claude Code 설정 수정: ${claudeSettingsPath}`);
    log(`- zshrc 수정: ${zshrcPath}`);
    const ok = promptYesNo("진행할까요? (y/N) ");
    if (!ok) fail("cancelled", 2);
  }

  ensureDir(proxyDir);
  ensureDir(authDir);
  ensureDir(path.dirname(proxyBin));
  ensureDir(path.dirname(plistProxy));

  await installCliProxyApiBinary({ proxyBin });

  log("Writing config + token sync script...");
  writeFileAtomic(configFile, proxyConfigYaml({ port: opts.port }), 0o644);
  writeFileAtomic(syncScriptPath, tokenSyncScript(), 0o755);

  log("Syncing token once...");
  run("/bin/bash", ["-lc", syncScriptPath]);

  log("Writing LaunchAgents...");
  writeFileAtomic(plistSync, buildPlistSync({ labelSync, syncScriptPath, homeDir, tokenSyncLog }), 0o644);
  writeFileAtomic(plistProxy, buildPlistProxy({ labelProxy, proxyBin, configFile, homeDir, proxyLog }), 0o644);

  log("Reloading LaunchAgents...");
  launchctlBootout(uid, labelProxy);
  launchctlBootout(uid, labelSync);
  launchctlBootstrap(uid, plistSync);
  launchctlBootstrap(uid, plistProxy);
  launchctlKickstart(uid, labelSync);
  launchctlKickstart(uid, labelProxy);

  const healthy = await waitForHealthy(opts.port, 10000);
  if (!healthy) fail(`proxy did not become healthy (check ${proxyLog})`);

  if (!opts.noClaudeSettings) {
    log("Updating Claude Code settings...");
    updateClaudeSettings({ claudeSettingsPath, port: opts.port, model: opts.model });
  } else {
    warn("--no-claude-settings set; skipping ~/.claude/settings.json update");
  }

  if (!opts.noZshrc) {
    log("Updating zshrc wrapper...");
    updateZshrc({ zshrcPath, port: opts.port });
  } else {
    warn("--no-zshrc set; skipping ~/.zshrc update");
  }

  log("Verifying reasoning.effort=xhigh ...");
  const ok = await verifyReasoningEffort(opts.port, opts.model);
  if (!ok) fail("expected reasoning.effort=xhigh but verification failed");

  log("");
  log("All done.");
  log(`- Proxy: http://127.0.0.1:${opts.port}`);
  log(`- Config: ${configFile}`);
  log(`- Claude settings: ${claudeSettingsPath}`);
  log(`- zshrc wrapper: ${zshrcPath}`);
  log(`- Next: run 'source ~/.zshrc' then 'claude'`);
}

async function startFlow(opts) {
  if (process.platform !== "darwin") fail("macOS only.");
  const homeDir = os.homedir();
  const username = getUsername();
  const uid = getUid();
  const labelProxy = `com.${username}.cli-proxy-api`;
  const plistProxy = path.join(homeDir, "Library", "LaunchAgents", `${labelProxy}.plist`);
  const labelSync = `com.${username}.cli-proxy-api-token-sync`;
  const plistSync = path.join(homeDir, "Library", "LaunchAgents", `${labelSync}.plist`);

  if (exists(plistSync)) {
    launchctlBootstrap(uid, plistSync);
    launchctlKickstart(uid, labelSync);
  }
  if (!exists(plistProxy)) fail(`missing plist: ${plistProxy} (run install first)`);
  launchctlBootstrap(uid, plistProxy);
  launchctlKickstart(uid, labelProxy);

  const healthy = await waitForHealthy(opts.port, 10000);
  if (!healthy) fail("proxy did not become healthy");
  log("proxy started");
}

async function stopFlow() {
  if (process.platform !== "darwin") fail("macOS only.");
  const username = getUsername();
  const uid = getUid();
  const labelProxy = `com.${username}.cli-proxy-api`;
  const labelSync = `com.${username}.cli-proxy-api-token-sync`;
  launchctlBootout(uid, labelProxy);
  launchctlBootout(uid, labelSync);
  log("proxy stopped (launchagents unloaded)");
}

async function statusFlow(opts) {
  const portOk = await proxyHealthcheck(opts.port);
  log(`healthcheck: ${portOk ? "OK" : "NOT RUNNING"} (http://127.0.0.1:${opts.port}/v1/models)`);
  if (process.platform === "darwin") {
    const username = getUsername();
    const uid = getUid();
    const labelProxy = `com.${username}.cli-proxy-api`;
    const labelSync = `com.${username}.cli-proxy-api-token-sync`;
    log(`launchctl proxy job: ${launchctlPrint(uid, labelProxy) ? "loaded" : "not loaded"}`);
    log(`launchctl token-sync job: ${launchctlPrint(uid, labelSync) ? "loaded" : "not loaded"}`);
  }
}

async function uninstallFlow(opts) {
  if (process.platform !== "darwin") fail("macOS only.");
  const homeDir = os.homedir();
  const username = getUsername();
  const uid = getUid();
  const labelProxy = `com.${username}.cli-proxy-api`;
  const labelSync = `com.${username}.cli-proxy-api-token-sync`;
  const plistProxy = path.join(homeDir, "Library", "LaunchAgents", `${labelProxy}.plist`);
  const plistSync = path.join(homeDir, "Library", "LaunchAgents", `${labelSync}.plist`);
  const zshrcPath = path.join(homeDir, ".zshrc");

  if (!opts.yes) {
    const ok = promptYesNo("LaunchAgents 제거 + ~/.zshrc 블록 제거를 진행할까요? (y/N) ");
    if (!ok) fail("cancelled", 2);
  }

  launchctlBootout(uid, labelProxy);
  launchctlBootout(uid, labelSync);

  if (exists(plistProxy)) fs.rmSync(plistProxy, { force: true });
  if (exists(plistSync)) fs.rmSync(plistSync, { force: true });

  if (exists(zshrcPath)) {
    const mode = fs.statSync(zshrcPath).mode & 0o777;
    backupFile(zshrcPath);
    const next = removeZshrcBlock(readText(zshrcPath));
    writeFileAtomic(zshrcPath, `${next.trimEnd()}\n`, mode);
  }

  log("uninstall completed (binaries/config left in place)");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === "help") usage(0);

  try {
    switch (opts.command) {
      case "install":
        await installFlow(opts);
        break;
      case "start":
        await startFlow(opts);
        break;
      case "stop":
        await stopFlow();
        break;
      case "status":
        await statusFlow(opts);
        break;
      case "uninstall":
        await uninstallFlow(opts);
        break;
      default:
        usage(1);
    }
  } catch (e) {
    fail(e?.stack || String(e));
  }
}

await main();
