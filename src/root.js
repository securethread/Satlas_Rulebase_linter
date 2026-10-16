// Find the rule base without being told where it is, and read the repo's optional .rblintrc.json.
//
// .rblintrc.json (in the rule base repo, committed):
//   { "root": "rules", "minVersion": "0.2.0" }
// root        rule base folder, relative to the config file (optional - auto-detected otherwise)
// minVersion  oldest rblint allowed to check this repo; older installs stop with an update message
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { REG_DIR, TREES } from "./config.js";

export const CONFIG_FILE = ".rblintrc.json";

export function looksLikeRuleBase(dir) {
  return [REG_DIR, ...TREES].some((d) => fs.existsSync(path.join(dir, d)));
}

export function gitTop(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// Nearest .rblintrc.json from `start` upward, stopping at the git top (or the filesystem root).
export function findConfig(start) {
  const stop = gitTop(start);
  let dir = path.resolve(start);
  for (;;) {
    const p = path.join(dir, CONFIG_FILE);
    if (fs.existsSync(p)) {
      let data;
      try {
        data = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch (e) {
        throw new Error(`${p} is not valid JSON: ${e.message}`);
      }
      return { file: p, dir, data };
    }
    if (dir === stop || path.dirname(dir) === dir) return null;
    dir = path.dirname(dir);
  }
}

// Search a couple of levels below `top` for the folder holding the registry.
function search(top, depth = 3) {
  const queue = [[top, 0]];
  while (queue.length) {
    const [dir, d] = queue.shift();
    if (fs.existsSync(path.join(dir, REG_DIR))) return dir;
    if (d >= depth) continue;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") queue.push([path.join(dir, e.name), d + 1]);
    }
  }
  return null;
}

// Order: explicit argument, config "root", the current folder, ./rules, then the repo (top, top/rules, search).
export function resolveRoot(cwd, explicit) {
  if (explicit) {
    // A folder that is not itself a rule base but is a repo with .rblintrc.json: follow its "root".
    const dir = path.resolve(cwd, explicit);
    if (!looksLikeRuleBase(dir) && fs.existsSync(path.join(dir, CONFIG_FILE))) {
      const config = findConfig(dir);
      if (config && config.dir === dir && config.data.root) return { root: path.resolve(dir, config.data.root), config, how: CONFIG_FILE };
    }
    return { root: dir, config: findConfig(cwd), how: "argument" };
  }
  const config = findConfig(cwd);
  if (config && config.data.root) return { root: path.resolve(config.dir, config.data.root), config, how: CONFIG_FILE };
  for (const c of [cwd, path.join(cwd, "rules")]) if (looksLikeRuleBase(c)) return { root: path.resolve(c), config, how: "found" };
  const top = gitTop(cwd);
  if (top) {
    for (const c of [top, path.join(top, "rules")]) if (looksLikeRuleBase(c)) return { root: c, config, how: "found" };
    const hit = search(top);
    if (hit) return { root: hit, config, how: "found" };
  }
  return { root: null, config, how: null };
}

// "0.10.2" >= "0.9.0" - plain numeric x.y.z comparison, enough for our own version numbers.
export function versionAtLeast(have, want) {
  const a = String(have).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const b = String(want).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}
