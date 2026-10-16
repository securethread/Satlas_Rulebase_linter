// rblint scaffold: the senior's "generate base" step. For every category declared in compliance,
// create attack/, defence/ and remediation/<cat>/ with file.list and a _ttp.yaml listing every
// registered id. Names are left empty on purpose: rblint fails until a maintainer fills them in.
// Existing files are never overwritten. Ids registered after a _ttp.yaml exists are reported, not
// written, so a maintainer adds them deliberately.
import fs from "fs";
import path from "path";
import YAML from "yaml";
import { COMPLIANCE_DIR, MAP_RE, TREES, TTP_FILE, FILE_LIST, FORMAT, COMPLIANCE_ROOT } from "./config.js";

function registry(root) {
  const dir = path.join(root, COMPLIANCE_DIR);
  if (!fs.existsSync(dir)) throw new Error(`${COMPLIANCE_DIR}/ not found - register categories there first`);
  const cats = new Map();
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(MAP_RE);
    if (!m) continue;
    const doc = YAML.parseDocument(fs.readFileSync(path.join(dir, name), "utf8"));
    if (doc.errors.length) throw new Error(`${COMPLIANCE_DIR}/${name} does not parse - run rblint and fix it first`);
    const data = doc.toJS() || {};
    const ids = (data[COMPLIANCE_ROOT] || []).map((m2) => m2 && m2.id).filter(Boolean);
    cats.set(m[1], ids);
  }
  return cats;
}

export function scaffold(root, { dryRun = false } = {}) {
  const created = [], pending = [];
  const write = (rel, text) => {
    created.push(rel);
    if (dryRun) return;
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  for (const [cat, ids] of registry(root)) {
    for (const tree of TREES) {
      const dir = `${tree}/${cat}`;
      const ttpRel = `${dir}/${TTP_FILE}`;
      const listRel = `${dir}/${FILE_LIST}`;
      const ttpAbs = path.join(root, ttpRel);
      if (!fs.existsSync(ttpAbs)) {
        const ttps = ids.map((id) => (tree === "attack" ? { id, name: "", compliance: id } : { id, name: "" }));
        write(ttpRel, new YAML.Document({ ttps }).toString(FORMAT));
      } else {
        const doc = YAML.parseDocument(fs.readFileSync(ttpAbs, "utf8"));
        const have = new Set(((doc.toJS() || {}).ttps || []).map((t) => t && t.id));
        const missing = ids.filter((id) => !have.has(id));
        if (missing.length) pending.push(`${ttpRel}: add ${missing.join(", ")}`);
      }
      if (!fs.existsSync(path.join(root, listRel))) write(listRel, TTP_FILE + "\n");
    }
  }
  return { created, pending };
}
