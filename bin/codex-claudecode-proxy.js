#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";

const DEFAULT_PORT = 8317;
const DEFAULT_MODEL = "gpt-5.3-codex";
// Tier selector models: Claude Code tiers select these, and CLIProxyAPI config
// maps them to different reasoning.effort values. Sonnet/Haiku are rewritten to
// call DEFAULT_MODEL upstream so the actual model stays fixed.
const DEFAULT_OPUS_MODEL = "gpt-5.3-codex(xhigh)";
const DEFAULT_SONNET_MODEL = "gpt-5.3-codex(high)";
const DEFAULT_HAIKU_MODEL = "gpt-5.3-codex(medium)";
// CLIProxyAPI releases frequently add new Codex model definitions. If the binary is
// too old, the proxy can fail requests with "unknown provider for model ...".
const MIN_CLI_PROXY_API_VERSION = "6.8.15";

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
  codex-claudecode-proxy [command]

Commands:
  install      Install + configure + start (default)
  start        Start proxy LaunchAgent
  stop         Stop proxy + sync LaunchAgents
  status       Show status
  uninstall    Remove LaunchAgents + restore Claude Code settings (keeps proxy files)
  purge        Uninstall + remove proxy files
  help         Show this help

Examples:
  npx -y codex-claudecode-proxy@latest
  npx -y codex-claudecode-proxy@latest status
  npx -y codex-claudecode-proxy@latest purge
`;
  console.log(txt);
  process.exit(code);
}

function parseArgs(argv) {
  const args = [...argv];
  const out = {
    command: "install",
  };

  if (args.length > 0 && !args[0].startsWith("-")) {
    out.command = args.shift();
  }

  while (args.length > 0) {
    const a = args.shift();
    if (a === "--help" || a === "-h" || a === "help") return { ...out, command: "help" };
    // Backward compatibility: allow legacy "non-interactive" flags as no-ops.
    if (a === "--yes" || a === "-y") continue;
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

function parseSemver(s) {
  const m = String(s || "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function compareSemver(a, b) {
  const aa = parseSemver(a);
  const bb = parseSemver(b);
  if (!aa || !bb) return null;
  if (aa.major !== bb.major) return aa.major - bb.major;
  if (aa.minor !== bb.minor) return aa.minor - bb.minor;
  return aa.patch - bb.patch;
}

function getCliProxyApiVersion(proxyBin) {
  if (!exists(proxyBin)) return null;
  // CLIProxyAPI prints its version in help/usage text.
  const r = run(proxyBin, ["--help"], { allowFail: true });
  const txt = `${r.stdout || ""}\n${r.stderr || ""}`;
  const m = txt.match(/CLIProxyAPI Version:\s*([0-9]+\.[0-9]+\.[0-9]+)/);
  return m ? m[1] : null;
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

function readPortFromProxyConfig(configFile) {
  if (!exists(configFile)) return null;
  try {
    const m = readText(configFile).match(/^\s*port:\s*(\d+)\s*$/m);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n <= 0 || n > 65535) return null;
    return n;
  } catch {
    return null;
  }
}

async function isLocalPortFree(port) {
  return await new Promise((resolve) => {
    const srv = net.createServer();
    // Don't keep the process alive just for this check.
    srv.unref();
    srv.once("error", () => resolve(false));
    srv.listen({ port, host: "127.0.0.1" }, () => {
      srv.close(() => resolve(true));
    });
  });
}

async function findAvailableLocalPort(preferredPort, scan = 20) {
  const start = Number(preferredPort);
  if (!Number.isInteger(start) || start <= 0 || start > 65535) return DEFAULT_PORT;

  for (let i = 0; i <= scan; i += 1) {
    const p = start + i;
    if (p <= 0 || p > 65535) break;
    // If our proxy is already responding, keep that port.
    if (await proxyHealthcheck(p)) return p;
    if (await isLocalPortFree(p)) return p;
  }

  // Fallback: ask the OS for an ephemeral free port.
  return await new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => resolve(DEFAULT_PORT));
    srv.listen({ port: 0, host: "127.0.0.1" }, () => {
      const addr = srv.address();
      const p = addr && typeof addr === "object" ? addr.port : DEFAULT_PORT;
      srv.close(() => resolve(p));
    });
  });
}

async function resolveProxyPort({ configFile }) {
  const fromConfig = readPortFromProxyConfig(configFile);
  if (fromConfig) {
    // If the configured port is already healthy, keep it.
    if (await proxyHealthcheck(fromConfig)) return fromConfig;
    // If the port is free, keep it.
    if (await isLocalPortFree(fromConfig)) return fromConfig;
    warn(`configured port is busy (${fromConfig}); selecting a free port`);
  }
  return await findAvailableLocalPort(DEFAULT_PORT);
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

async function verifyReasoningEffort(port, model, expectedEffort) {
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
      if (effort === expectedEffort) return true;
      await sleep(1000);
    } catch {
      await sleep(1000);
    }
  }
  return false;
}

function proxyConfigYaml({ port }) {
  return `port: ${port}
auth-dir: "~/.cli-proxy-api/auths"

# Retry transient upstream failures and keep streaming connections alive.
# This helps reduce intermittent "context canceled" errors seen in Claude Code tool flows.
request-retry: 6
max-retry-interval: 60
streaming:
  keepalive-seconds: 15
  bootstrap-retries: 2

payload:
  override:
    # Claude Code exposes Opus/Sonnet/Haiku tiers. We keep tier-specific model IDs
    # (so CPA can resolve providers) and control behavior via reasoning.effort.
    - models:
        - name: "${DEFAULT_OPUS_MODEL}"
          protocol: "codex"
      params:
        "model": "${DEFAULT_MODEL}"
        "reasoning.effort": "xhigh"
        "reasoning.summary": "auto"
    - models:
        - name: "${DEFAULT_SONNET_MODEL}"
          protocol: "codex"
      params:
        "model": "${DEFAULT_MODEL}"
        "reasoning.effort": "high"
        "reasoning.summary": "auto"
    - models:
        - name: "${DEFAULT_HAIKU_MODEL}"
          protocol: "codex"
      params:
        "model": "${DEFAULT_MODEL}"
        "reasoning.effort": "medium"
        "reasoning.summary": "auto"

    # Safety net: if Claude Code is configured to send a real Codex model name,
    # ensure we still use the Codex protocol and request a reasoning summary.
    - models:
        - name: "gpt-*"
          protocol: "codex"
      params:
        "reasoning.summary": "auto"
`;
}

function ensureEnvDefault(env, key, value) {
  if (!(key in env)) env[key] = value;
}

function ensureEnvMinInt(env, key, minValue) {
  const cur = Number.parseInt(String(env[key] ?? ""), 10);
  if (!Number.isFinite(cur) || cur < minValue) env[key] = String(minValue);
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
  const forceUpdate = process.env.CODEX_CLAUDECODE_PROXY_FORCE_CLI_PROXY_API_UPDATE === "1";
  const installedVersion = getCliProxyApiVersion(proxyBin);
  if (exists(proxyBin) && !forceUpdate) {
    // If we can't determine the version, don't disrupt a potentially customized setup.
    // Users can force an update by setting CODEX_CLAUDECODE_PROXY_FORCE_CLI_PROXY_API_UPDATE=1.
    if (!installedVersion) {
      log(`CLIProxyAPI already installed: ${proxyBin}`);
      return;
    }

    const cmp = compareSemver(installedVersion, MIN_CLI_PROXY_API_VERSION);
    if (cmp == null || cmp >= 0) {
      log(`CLIProxyAPI already installed: ${proxyBin} (v${installedVersion})`);
      return;
    }

    warn(`CLIProxyAPI v${installedVersion} is older than v${MIN_CLI_PROXY_API_VERSION}; updating...`);
  } else if (exists(proxyBin) && forceUpdate) {
    warn(`Forcing CLIProxyAPI update (installed=${installedVersion ? `v${installedVersion}` : "unknown"})...`);
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

  const tmpOut = `${proxyBin}.tmp.${process.pid}.${nowTs()}`;
  fs.copyFileSync(found, tmpOut);
  fs.chmodSync(tmpOut, 0o755);
  fs.renameSync(tmpOut, proxyBin);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  log(`Installed: ${proxyBin}`);
}

function updateClaudeSettings({ claudeSettingsPath, port }) {
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

  json.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  // Placeholder token. Avoid secret-like prefixes (e.g., "sk-") to prevent false-positive secret scans.
  json.env.ANTHROPIC_AUTH_TOKEN = "proxy-local";
  // Avoid global model overrides. Let Claude Code tiers select models.
  delete json.env.ANTHROPIC_MODEL;
  delete json.env.ANTHROPIC_SMALL_FAST_MODEL;
  json.env.ANTHROPIC_DEFAULT_OPUS_MODEL = DEFAULT_OPUS_MODEL;
  json.env.ANTHROPIC_DEFAULT_SONNET_MODEL = DEFAULT_SONNET_MODEL;
  json.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = DEFAULT_HAIKU_MODEL;

  // Tool flows can be slow with large tool schemas. Keep timeouts generous.
  // https://docs.claude.com/en/docs/claude-code/settings
  ensureEnvMinInt(json.env, "BASH_DEFAULT_TIMEOUT_MS", 120000);
  ensureEnvMinInt(json.env, "BASH_MAX_TIMEOUT_MS", 600000);
  ensureEnvMinInt(json.env, "MCP_TIMEOUT", 30000);
  ensureEnvMinInt(json.env, "MCP_TOOL_TIMEOUT", 600000);
  ensureEnvDefault(json.env, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
  // Best-effort (not documented), but commonly used in the wild and safe to keep high.
  ensureEnvMinInt(json.env, "API_TIMEOUT_MS", 600000);

  writeFileAtomic(claudeSettingsPath, `${JSON.stringify(json, null, 2)}\n`, 0o600);
}

function cleanupClaudeSettings({ claudeSettingsPath }) {
  if (!exists(claudeSettingsPath)) return;

  backupFile(claudeSettingsPath);

  let json;
  try {
    json = JSON.parse(readText(claudeSettingsPath));
  } catch {
    fail(`failed to parse JSON: ${claudeSettingsPath}`);
  }

  if (!json || typeof json !== "object") return;

  if (json.env && typeof json.env === "object") {
    delete json.env.ANTHROPIC_BASE_URL;
    delete json.env.ANTHROPIC_AUTH_TOKEN;
    delete json.env.ANTHROPIC_MODEL;
    delete json.env.ANTHROPIC_SMALL_FAST_MODEL;
    delete json.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    delete json.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    delete json.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  }

  writeFileAtomic(claudeSettingsPath, `${JSON.stringify(json, null, 2)}\n`, 0o600);
}

function cleanExistingInstall({ uid, labelProxy, labelSync, plistProxy, plistSync, proxyDir, claudeSettingsPath }) {
  const hasInstallArtifacts = exists(proxyDir) || exists(plistProxy) || exists(plistSync);
  if (!hasInstallArtifacts) return false;

  log("Existing install detected; cleaning up before reinstall...");
  launchctlBootout(uid, labelProxy);
  launchctlBootout(uid, labelSync);
  if (exists(plistProxy)) fs.rmSync(plistProxy, { force: true });
  if (exists(plistSync)) fs.rmSync(plistSync, { force: true });
  if (exists(proxyDir)) fs.rmSync(proxyDir, { recursive: true, force: true });
  // Best-effort cleanup so Claude doesn't keep pointing at a removed proxy.
  cleanupClaudeSettings({ claudeSettingsPath });
  return true;
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

async function installFlow(opts) {
  if (process.platform !== "darwin") {
    fail("macOS only (LaunchAgents-based install).");
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

  const labelProxy = `com.${username}.cli-proxy-api`;
  const labelSync = `com.${username}.cli-proxy-api-token-sync`;
  const plistProxy = path.join(homeDir, "Library", "LaunchAgents", `${labelProxy}.plist`);
  const plistSync = path.join(homeDir, "Library", "LaunchAgents", `${labelSync}.plist`);

  // Compute port before cleaning, so re-running install keeps existing config-based port.
  const port = await resolveProxyPort({ configFile });

  const codexAuth = path.join(homeDir, ".codex", "auth.json");
  if (!exists(codexAuth)) {
    fail(`missing ${codexAuth} (Codex CLI login required)`);
  }

  cleanExistingInstall({
    uid,
    labelProxy,
    labelSync,
    plistProxy,
    plistSync,
    proxyDir,
    claudeSettingsPath,
  });

  ensureDir(proxyDir);
  ensureDir(authDir);
  ensureDir(path.dirname(proxyBin));
  ensureDir(path.dirname(plistProxy));

  await installCliProxyApiBinary({ proxyBin });

  log("Writing config + token sync script...");
  writeFileAtomic(configFile, proxyConfigYaml({ port }), 0o644);
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

  const healthy = await waitForHealthy(port, 10000);
  if (!healthy) fail(`proxy did not become healthy (check ${proxyLog})`);

  log("Updating Claude Code settings...");
  updateClaudeSettings({ claudeSettingsPath, port });

  log("Verifying tier reasoning.effort mapping (opus/sonnet/haiku) ...");
  const okOpus = await verifyReasoningEffort(port, DEFAULT_OPUS_MODEL, "xhigh");
  if (!okOpus) fail("expected opus reasoning.effort=xhigh but verification failed");
  const okSonnet = await verifyReasoningEffort(port, DEFAULT_SONNET_MODEL, "high");
  if (!okSonnet) fail("expected sonnet reasoning.effort=high but verification failed");
  const okHaiku = await verifyReasoningEffort(port, DEFAULT_HAIKU_MODEL, "medium");
  if (!okHaiku) fail("expected haiku reasoning.effort=medium but verification failed");

  log("");
  log("All done.");
  log(`- Proxy: http://127.0.0.1:${port}`);
  log(`- Config: ${configFile}`);
  log(`- Claude settings: ${claudeSettingsPath}`);
  log("- Next: run 'claude'");
}

async function startFlow(opts) {
  if (process.platform !== "darwin") fail("macOS only.");
  const homeDir = os.homedir();
  const username = getUsername();
  const uid = getUid();
  const configFile = path.join(homeDir, ".cli-proxy-api", "config.yaml");
  const port = readPortFromProxyConfig(configFile) ?? DEFAULT_PORT;
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

  const healthy = await waitForHealthy(port, 10000);
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
  const homeDir = os.homedir();
  const configFile = path.join(homeDir, ".cli-proxy-api", "config.yaml");
  const port = readPortFromProxyConfig(configFile) ?? DEFAULT_PORT;
  const portOk = await proxyHealthcheck(port);
  log(`healthcheck: ${portOk ? "OK" : "NOT RUNNING"} (http://127.0.0.1:${port}/v1/models)`);
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
  const claudeSettingsPath = path.join(homeDir, ".claude", "settings.json");
  const proxyDir = path.join(homeDir, ".cli-proxy-api");
  const proxyBin = path.join(homeDir, ".local", "bin", "cli-proxy-api");

  launchctlBootout(uid, labelProxy);
  launchctlBootout(uid, labelSync);

  if (exists(plistProxy)) fs.rmSync(plistProxy, { force: true });
  if (exists(plistSync)) fs.rmSync(plistSync, { force: true });

  // Always restore Claude Code settings so "claude" doesn't keep pointing at a removed proxy.
  cleanupClaudeSettings({ claudeSettingsPath });

  if (opts.command === "purge") {
    // Remove proxy installation files (best-effort).
    if (exists(proxyDir)) fs.rmSync(proxyDir, { recursive: true, force: true });
    if (exists(proxyBin)) fs.rmSync(proxyBin, { force: true });
    log("purge completed (proxy files removed)");
    return;
  }

  log("uninstall completed (proxy files left in place)");
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
      case "purge":
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
