// Shared test helpers: every test works on a throw-away copy of test/fixtures/valid.
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { lint } from "../src/lint.js";
import { WorktreeSource } from "../src/source.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE = path.join(HERE, "fixtures", "valid");
export const BIN = path.join(HERE, "..", "bin", "rblint.js");

// A fresh copy of the valid fixture. Returns its folder.
export function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rblint-"));
  const root = path.join(dir, "rules");
  fs.cpSync(FIXTURE, root, { recursive: true });
  return root;
}

export const read = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
export function write(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}
export const append = (root, rel, text) => write(root, rel, read(root, rel) + text);
export const remove = (root, rel) => fs.rmSync(path.join(root, rel), { recursive: true, force: true });
export function rename(root, from, to) {
  fs.renameSync(path.join(root, from), path.join(root, to));
}
// Replace the first occurrence; fails loudly if the text isn't there, so a fixture change can't
// silently turn a test into a no-op.
export function replace(root, rel, from, to) {
  const t = read(root, rel);
  if (!t.includes(from)) throw new Error(`${rel} does not contain ${JSON.stringify(from)}`);
  write(root, rel, t.replace(from, to));
}

// Problems from an in-process run, plus convenient views of them.
export function check(root) {
  const items = lint(new WorktreeSource(root)).sorted();
  const real = items.filter((p) => p.sev !== "info");
  return { items, codes: [...new Set(real.map((p) => p.code))].sort(), errors: real.filter((p) => p.sev === "error") };
}

export function cli(args, opts = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", ...opts, env: { ...process.env, NO_COLOR: "1", ...(opts.env || {}) } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// A git repo holding the fixture under rules/, with one commit.
export function repo() {
  const rules = copy();
  const top = path.dirname(rules);
  git(top, "init", "-q");
  git(top, "config", "user.email", "test@example.com");
  git(top, "config", "user.name", "test");
  git(top, "add", "-A");
  git(top, "commit", "-qm", "base");
  return { top, rules };
}
