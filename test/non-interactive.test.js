import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync, spawn } from "node:child_process";

// Tier selectors (what Claude Code will send as `model` when you pick Opus/Sonnet/Haiku).
// Keep UX explicit: effort is encoded in the visible model name, while upstream
// requests are rewritten to gpt-5.3-codex.
const EXPECTED_OPUS_MODEL = "gpt-5.3-codex(xhigh)";
const EXPECTED_SONNET_MODEL = "gpt-5.3-codex(high)";
const EXPECTED_HAIKU_MODEL = "gpt-5.3-codex(medium)";

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(p, content, mode) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
  if (mode != null) fs.chmodSync(p, mode);
}

function startFakeProxyServer() {
  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end();
      return;
    }

    if (req.url === "/v1/models" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [] }));
      return;
    }

    if (req.url === "/v1/responses" && req.method === "POST") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (d) => { body += d; });
      req.on("end", () => {
        let model = "";
        try {
          model = JSON.parse(body || "{}")?.model || "";
        } catch {
          model = "";
        }

        const effort =
          model === EXPECTED_OPUS_MODEL ? "xhigh" :
          model === EXPECTED_SONNET_MODEL ? "high" :
          model === EXPECTED_HAIKU_MODEL ? "medium" :
          "xhigh";

        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ reasoning: { effort } }));
      });
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr !== "object") {
        reject(new Error("failed to determine listen port"));
        return;
      }
      resolve({ server, port: addr.port });
    });
  });
}

function writeStubLaunchctl(stubBinDir) {
  const p = path.join(stubBinDir, "launchctl");
  writeFile(
    p,
    `#!/usr/bin/env bash
set -euo pipefail
# no-op stub: avoid touching the real launchd during tests
exit 0
`,
    0o755,
  );
}

function makeCodexAuthJson() {
  // plutil -extract works with JSON on macOS, so keep this shape.
  return JSON.stringify(
    {
      tokens: {
        access_token: "test-access-token",
        id_token: "test-id-token",
        refresh_token: "test-refresh-token",
        account_id: "test-account-id",
      },
      last_refresh: "0",
    },
    null,
    2,
  );
}

test("install succeeds without --yes (non-interactive only)", async (t) => {
  const home = mkTmpDir("codex-claudecode-proxy-home-");
  const stubBin = path.join(home, "stub-bin");
  fs.mkdirSync(stubBin, { recursive: true });
  writeStubLaunchctl(stubBin);

  // Required by installFlow().
  writeFile(path.join(home, ".codex", "auth.json"), makeCodexAuthJson(), 0o600);

  // Skip network download of CLIProxyAPI by pre-creating the binary.
  const proxyBin = path.join(home, ".local", "bin", "cli-proxy-api");
  writeFile(proxyBin, "#!/usr/bin/env bash\nexit 0\n", 0o755);

  const { server, port } = await startFakeProxyServer();
  t.after(() => server.close());

  // Force installer to use the already-configured port without requiring flags.
  writeFile(
    path.join(home, ".cli-proxy-api", "config.yaml"),
    `port: ${port}\nauth-dir: \"~/.cli-proxy-api/auths\"\n`,
    0o644,
  );

  const cli = path.resolve(process.cwd(), "bin", "codex-claudecode-proxy.js");
  const r = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [cli, "install"],
      {
        env: {
          ...process.env,
          HOME: home,
          USER: "testuser",
          PATH: `${stubBin}:${process.env.PATH || ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("close", (code) => resolve({ status: code, stdout, stderr }));
  });

  assert.equal(
    r.status,
    0,
    `expected exit 0\nstdout:\n${r.stdout || ""}\nstderr:\n${r.stderr || ""}`,
  );

  // zshrc should not be modified/created in the new minimal CLI.
  assert.equal(fs.existsSync(path.join(home, ".zshrc")), false, "expected no ~/.zshrc modifications");

  // Claude settings should exist and point to the configured port.
  const settingsPath = path.join(home, ".claude", "settings.json");
  assert.equal(fs.existsSync(settingsPath), true, "expected ~/.claude/settings.json to be created");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(
    settings?.env?.ANTHROPIC_BASE_URL,
    `http://127.0.0.1:${port}`,
    "expected ANTHROPIC_BASE_URL to point at local proxy port",
  );
  assert.equal("ANTHROPIC_MODEL" in (settings?.env || {}), false, "expected no ANTHROPIC_MODEL override");
  assert.equal(settings?.env?.ANTHROPIC_DEFAULT_OPUS_MODEL, EXPECTED_OPUS_MODEL);
  assert.equal(settings?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL, EXPECTED_SONNET_MODEL);
  assert.equal(settings?.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL, EXPECTED_HAIKU_MODEL);
  assert.equal(settings?.env?.BASH_DEFAULT_TIMEOUT_MS, "120000");
  assert.equal(settings?.env?.BASH_MAX_TIMEOUT_MS, "600000");
  assert.equal(settings?.env?.MCP_TIMEOUT, "30000");
  assert.equal(settings?.env?.MCP_TOOL_TIMEOUT, "600000");
  assert.equal(settings?.env?.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
  assert.equal(settings?.env?.API_TIMEOUT_MS, "600000");

  // Config should keep the configured port.
  const cfg = fs.readFileSync(path.join(home, ".cli-proxy-api", "config.yaml"), "utf8");
  assert.match(cfg, new RegExp(`^port:\\s*${port}\\s*$`, "m"), "expected config.yaml to keep selected port");
  assert.equal(cfg.includes(`name: "${EXPECTED_OPUS_MODEL}"`), true);
  assert.equal(cfg.includes(`name: "${EXPECTED_SONNET_MODEL}"`), true);
  assert.equal(cfg.includes(`name: "${EXPECTED_HAIKU_MODEL}"`), true);
  assert.match(cfg, new RegExp(`\\\"reasoning\\.effort\\\"\\:\\s*\\\"xhigh\\\"`, "m"));
  assert.match(cfg, new RegExp(`\\\"reasoning\\.effort\\\"\\:\\s*\\\"high\\\"`, "m"));
  assert.match(cfg, new RegExp(`\\\"reasoning\\.effort\\\"\\:\\s*\\\"medium\\\"`, "m"));
  assert.match(cfg, new RegExp(`\\\"model\\\"\\:\\s*\\\"gpt-5\\.3-codex\\\"`, "m"), "expected upstream model rewrite to gpt-5.3-codex");
});

test("install cleans existing install artifacts on re-run", async (t) => {
  const home = mkTmpDir("codex-claudecode-proxy-home-");
  const stubBin = path.join(home, "stub-bin");
  fs.mkdirSync(stubBin, { recursive: true });
  writeStubLaunchctl(stubBin);

  // Required by installFlow().
  writeFile(path.join(home, ".codex", "auth.json"), makeCodexAuthJson(), 0o600);

  // Skip network download of CLIProxyAPI by pre-creating the binary.
  const proxyBin = path.join(home, ".local", "bin", "cli-proxy-api");
  writeFile(proxyBin, "#!/usr/bin/env bash\nexit 0\n", 0o755);

  const { server, port } = await startFakeProxyServer();
  t.after(() => server.close());

  // Force installer to use the already-configured port without requiring flags.
  writeFile(
    path.join(home, ".cli-proxy-api", "config.yaml"),
    `port: ${port}\nauth-dir: \"~/.cli-proxy-api/auths\"\n`,
    0o644,
  );

  const cli = path.resolve(process.cwd(), "bin", "codex-claudecode-proxy.js");

  const runInstall = async () => await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [cli, "install"],
      {
        env: {
          ...process.env,
          HOME: home,
          USER: "testuser",
          PATH: `${stubBin}:${process.env.PATH || ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("close", (code) => resolve({ status: code, stdout, stderr }));
  });

  const r1 = await runInstall();
  assert.equal(
    r1.status,
    0,
    `expected exit 0\nstdout:\n${r1.stdout || ""}\nstderr:\n${r1.stderr || ""}`,
  );

  // Create a sentinel file that should be removed by the next install.
  const sentinel = path.join(home, ".cli-proxy-api", "sentinel.txt");
  writeFile(sentinel, "junk\n", 0o644);
  assert.equal(fs.existsSync(sentinel), true);

  const r2 = await runInstall();
  assert.equal(
    r2.status,
    0,
    `expected exit 0\nstdout:\n${r2.stdout || ""}\nstderr:\n${r2.stderr || ""}`,
  );
  assert.equal(fs.existsSync(sentinel), false, "expected install to remove previous proxyDir contents");

  // Claude settings should be rewritten and still point to the configured port.
  const settingsPath = path.join(home, ".claude", "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(settings?.env?.ANTHROPIC_BASE_URL, `http://127.0.0.1:${port}`);
  assert.equal("ANTHROPIC_MODEL" in (settings?.env || {}), false);
  assert.equal(settings?.env?.ANTHROPIC_DEFAULT_OPUS_MODEL, EXPECTED_OPUS_MODEL);
  assert.equal(settings?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL, EXPECTED_SONNET_MODEL);
  assert.equal(settings?.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL, EXPECTED_HAIKU_MODEL);

  // Config should still keep the configured port.
  const cfg = fs.readFileSync(path.join(home, ".cli-proxy-api", "config.yaml"), "utf8");
  assert.match(cfg, new RegExp(`^port:\\s*${port}\\s*$`, "m"));
});

test("uninstall succeeds without --yes (non-interactive only)", () => {
  const home = mkTmpDir("codex-claudecode-proxy-home-");
  const stubBin = path.join(home, "stub-bin");
  fs.mkdirSync(stubBin, { recursive: true });
  writeStubLaunchctl(stubBin);

  const cli = path.resolve(process.cwd(), "bin", "codex-claudecode-proxy.js");
  const r = spawnSync(process.execPath, [cli, "uninstall"], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USER: "testuser",
      PATH: `${stubBin}:${process.env.PATH || ""}`,
    },
  });

  assert.equal(
    r.status,
    0,
    `expected exit 0\nstdout:\n${r.stdout || ""}\nstderr:\n${r.stderr || ""}`,
  );
});
