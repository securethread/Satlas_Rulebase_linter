// rblint --fix: whitespace only (space after "key:", tabs, indentation). Never changes a value,
// never adds or removes a field. Files that still don't parse are left alone and reported.
import fs from "fs";
import path from "path";
import { fixText } from "./yamlfile.js";
import { REG_DIR, TREES } from "./config.js";

function yamlFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".yaml")) out.push(p);
    }
  };
  for (const top of [REG_DIR, ...TREES]) {
    const p = path.join(root, top);
    if (fs.existsSync(p)) walk(p);
  }
  return out;
}

export function fix(root, { dryRun = false } = {}) {
  const changed = [], unfixable = [];
  for (const file of yamlFiles(root)) {
    const src = fs.readFileSync(file, "utf8");
    const out = fixText(src);
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (out == null) { unfixable.push(rel); continue; }
    if (out !== src) {
      changed.push(rel);
      if (!dryRun) fs.writeFileSync(file, out);
    }
  }
  return { changed, unfixable };
}
