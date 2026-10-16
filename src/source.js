// Where files are read from. The checks never touch the filesystem directly, so the same
// checks run against the working tree (CI, manual), the git index (--staged) or HEAD.
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

// Paths given to and returned by a source are relative to the rule base root, "/"-separated.
// Names starting with "." (.DS_Store, .gitkeep, editor swap files) are never listed: they are not
// rule files, and listing them would make RB-G03 block commits on a Mac.

export class WorktreeSource {
  constructor(root) {
    this.root = path.resolve(root);
    this.label = "working tree";
  }
  abs(rel) {
    return path.join(this.root, ...rel.split("/").filter(Boolean));
  }
  exists(rel) {
    return fs.existsSync(this.abs(rel));
  }
  isDir(rel) {
    try { return fs.statSync(this.abs(rel)).isDirectory(); } catch { return false; }
  }
  list(rel) {
    try {
      return fs.readdirSync(this.abs(rel), { withFileTypes: true })
        .filter((d) => !d.name.startsWith("."))
        .map((d) => ({ name: d.name, dir: d.isDirectory() }));
    } catch { return []; }
  }
  read(rel) {
    try { return fs.readFileSync(this.abs(rel), "utf8"); } catch { return null; }
  }
}

function git(cwd, args, opts = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts });
}

// ref ":" reads the index (what is about to be committed); "HEAD" reads the last commit.
export class GitSource {
  constructor(root, ref) {
    this.root = path.resolve(root);
    this.ref = ref;
    this.label = ref === ":" ? "staged changes" : ref;
    this.top = git(this.root, ["rev-parse", "--show-toplevel"]).trim();
    const prefix = path.relative(this.top, this.root).split(path.sep).join("/");
    this.prefix = prefix ? prefix + "/" : "";
    const raw = ref === ":"
      ? git(this.top, ["ls-files", "-z", "--", this.prefix || "."])
      : git(this.top, ["ls-tree", "-r", "--name-only", "-z", ref, "--", this.prefix || "."]);
    this.files = new Set();
    this.dirs = new Set([""]);
    for (const full of raw.split("\0").filter(Boolean)) {
      if (!full.startsWith(this.prefix)) continue;
      const rel = full.slice(this.prefix.length);
      this.files.add(rel);
      const parts = rel.split("/");
      for (let i = 1; i < parts.length; i++) this.dirs.add(parts.slice(0, i).join("/"));
    }
    this.cache = new Map();
  }
  norm(rel) {
    return rel.replace(/\/+$/, "").replace(/^\/+/, "");
  }
  exists(rel) {
    const r = this.norm(rel);
    return this.files.has(r) || this.dirs.has(r);
  }
  isDir(rel) {
    return this.dirs.has(this.norm(rel));
  }
  list(rel) {
    const base = this.norm(rel);
    const pre = base ? base + "/" : "";
    const seen = new Map();
    for (const f of this.files) {
      if (!f.startsWith(pre)) continue;
      const rest = f.slice(pre.length);
      const name = rest.split("/")[0];
      if (!name.startsWith(".") && !seen.has(name)) seen.set(name, rest.includes("/"));
    }
    return [...seen].map(([name, dir]) => ({ name, dir }));
  }
  read(rel) {
    const r = this.norm(rel);
    if (!this.files.has(r)) return null;
    if (!this.cache.has(r)) {
      const spec = this.ref === ":" ? ":" + this.prefix + r : this.ref + ":" + this.prefix + r;
      this.cache.set(r, git(this.top, ["show", spec]));
    }
    return this.cache.get(r);
  }
}

export function hasHead(root) {
  try { git(root, ["rev-parse", "--verify", "-q", "HEAD"]); return true; } catch { return false; }
}

export function stagedPaths(root) {
  const top = git(root, ["rev-parse", "--show-toplevel"]).trim();
  const prefix = path.relative(top, path.resolve(root)).split(path.sep).join("/");
  const pre = prefix ? prefix + "/" : "";
  return git(top, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRD"])
    .split("\0").filter((p) => p && p.startsWith(pre)).map((p) => p.slice(pre.length));
}
