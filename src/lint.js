// One lint run over a source. Order matters: each step only reads indexes built before it.
//   registry (industries, compliance)  ->  attack/<cat>  ->  defence/<cat>, remediation/<cat>
import { Reporter } from "./report.js";
import { checkIndustries, checkCompliance } from "./checks/registry.js";
import { checkTrees } from "./checks/tree.js";
import { REG_DIR, COMPLIANCE_DIR, INDUSTRIES_FILE } from "./config.js";

export function lint(source) {
  const ctx = {
    source,
    rep: new Reporter(),
    idx: { industries: null, compliance: null, cats: new Set(), catFiles: {}, ttp: {}, names: {}, namesComplete: {}, defNames: {} },
  };
  checkIndustries(ctx);
  checkCompliance(ctx);
  checkTrees(ctx);
  if (!ctx.idx.industries) ctx.rep.add(REG_DIR + "/", 0, 0, "RB-I01", `agent checks are skipped until ${INDUSTRIES_FILE} parses`, `fix ${INDUSTRIES_FILE} first`, "info");
  if (!ctx.idx.compliance) ctx.rep.add(COMPLIANCE_DIR + "/", 0, 0, "RB-I01", '"registered in compliance" checks are skipped until every compliance file parses', "fix the compliance files first", "info");
  return ctx.rep;
}

// Message text without anything that moves when lines are added above it:
// "line 12", "file.yaml:12", "signature 5:", "ttp 3", "entry 2 > entry 4".
export function stable(msg) {
  return String(msg)
    .replace(/\bline \d+/g, "line #")
    .replace(/(\.ya?ml):\d+(?::\d+)?/g, "$1:#")
    .replace(/\b(signature|remediation|ttp|mapping|entry) \d+/g, "$1 #");
}

// --staged: report only what this commit introduces. Problems that already exist on HEAD
// (someone else's broken file) never block you; knock-on breakage you cause elsewhere does.
export function newProblems(after, before) {
  const key = (p) => `${p.file}\u0000${p.code}\u0000${stable(p.msg)}`;
  const old = new Map();
  for (const p of before) old.set(key(p), (old.get(key(p)) || 0) + 1);
  return after.filter((p) => {
    const k = key(p);
    const n = old.get(k) || 0;
    if (n > 0) { old.set(k, n - 1); return false; }
    return true;
  });
}
