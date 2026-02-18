#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function eprintln(msg) {
  process.stderr.write(`${msg}\n`);
}

function fail(msg, code = 1) {
  eprintln(msg);
  process.exit(code);
}

function asString(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function writeFileAtomic(dstPath, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  const tmp = `${dstPath}.tmp.${process.pid}.${Date.now()}`;

  try {
    fs.writeFileSync(tmp, content, { encoding: "utf8", mode });

    // On Windows, rename fails if the destination already exists. Best-effort:
    // remove the destination then rename.
    try {
      fs.renameSync(tmp, dstPath);
    } catch (e) {
      try {
        fs.rmSync(dstPath, { force: true });
      } catch {
        // ignore
      }
      fs.renameSync(tmp, dstPath);
    }

    try {
      fs.chmodSync(dstPath, mode);
    } catch {
      // ignore (e.g., Windows)
    }
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // ignore
    }
    throw e;
  }
}

const homeDir = process.env.HOME || os.homedir();
const DEFAULT_SRC = path.join(homeDir, ".codex", "auth.json");
const DEFAULT_DST = path.join(homeDir, ".cli-proxy-api", "auths", "codex-from-codex-cli.json");

const [srcArg, dstArg] = process.argv.slice(2);
const srcPath = srcArg || DEFAULT_SRC;
const dstPath = dstArg || DEFAULT_DST;

if (!fs.existsSync(srcPath)) {
  fail(`missing ${srcPath} (Codex CLI login required)`);
}

let src;
try {
  src = JSON.parse(fs.readFileSync(srcPath, "utf8"));
} catch {
  fail(`failed to parse JSON: ${srcPath}`);
}

const tokens = src?.tokens && typeof src.tokens === "object" ? src.tokens : {};
const accessToken = tokens?.access_token;
if (!accessToken || typeof accessToken !== "string") {
  fail(`tokens.access_token missing in ${srcPath}`);
}

const out = {
  access_token: accessToken,
  account_id: asString(tokens?.account_id),
  disabled: false,
  email: "",
  expired: "",
  id_token: asString(tokens?.id_token),
  last_refresh: asString(src?.last_refresh),
  refresh_token: asString(tokens?.refresh_token),
  type: "codex",
};

try {
  writeFileAtomic(dstPath, `${JSON.stringify(out, null, 2)}\n`, 0o600);
} catch (e) {
  fail(e?.message ? `failed to write ${dstPath}: ${e.message}` : `failed to write ${dstPath}`);
}
