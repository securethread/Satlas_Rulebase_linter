// The registry folder: industries_agent.yaml (IND-*) and compliance/_<cat>_mapping.yaml (CMP-*).
// Compliance is the source of truth: it declares every category and every ttp id.
import { REG_DIR, COMPLIANCE_DIR, INDUSTRIES_FILE, MAP_RE, COMPLIANCE_ROOT, idRe } from "../config.js";
import { checkFolder } from "../filelist.js";
import { load, rootList, checkFields, requireValue, get, str, at, isSeq, isMap, isScalar } from "../yamlfile.js";

export function checkIndustries(ctx) {
  const { rep, source, idx } = ctx;
  if (!source.isDir(REG_DIR)) {
    rep.add(REG_DIR + "/", 0, 0, "IND-01", `${REG_DIR}/ is missing`, `create it with ${INDUSTRIES_FILE} and file.list`);
    return;
  }
  for (const e of source.list(REG_DIR)) {
    if (!e.dir && e.name !== "file.list" && e.name !== INDUSTRIES_FILE) {
      rep.add(`${REG_DIR}/${e.name}`, 0, 0, "IND-01", `only ${INDUSTRIES_FILE} may exist in ${REG_DIR}/`, `delete this file; add entries to ${INDUSTRIES_FILE} instead`);
    }
  }
  const files = checkFolder(ctx, REG_DIR, {
    allowed: (n) => n === INDUSTRIES_FILE,
    hint: `${REG_DIR}/file.list names only ${INDUSTRIES_FILE}`,
  });
  const file = files.find((f) => f.endsWith("/" + INDUSTRIES_FILE));
  if (!file) return;
  const f = load(ctx, file);
  if (!f) return;
  const items = rootList(ctx, f, "agents", "IND-02");
  if (!items) return;
  const names = new Set();
  const walk = (list, parent) => {
    const siblings = new Map();
    list.forEach((it, i) => {
      const where = (parent ? parent + " > " : "") + "entry " + (i + 1);
      if (!checkFields(ctx, f, it, ["name", "description", "sub"], where)) return;
      const np = requireValue(ctx, f, it, "name", "IND-03", where);
      const d = get(it, "description");
      if (d && d.value && !isScalar(d.value)) rep.add(f.file, ...at(f, d.value), "IND-06", `${where}: description must be text`, 'write description: "..."');
      let full = null;
      if (np) {
        const n = str(np);
        if (n.includes(".")) rep.add(f.file, ...at(f, np.value), "IND-05", `name "${n}" contains "."`, '"." joins a parent and its sub (Banking.Loan) - remove it from the name');
        if (siblings.has(n)) rep.add(f.file, ...at(f, np.value), "IND-04", `name "${n}" is already used at this level (line ${siblings.get(n)})`, "names are unique among siblings - rename one");
        else siblings.set(n, f.pos(np.value).line);
        full = parent ? parent + "." + n : n;
        names.add(full);
      }
      const sp = get(it, "sub");
      if (sp) {
        if (!isSeq(sp.value)) rep.add(f.file, ...at(f, sp.value || sp.key), "IND-06", `${where}: sub must be a list`, 'write each sub entry as "- name: ..."');
        else if (full) walk(sp.value.items, full);
      }
    });
  };
  walk(items, "");
  idx.industries = names;
}

export function checkCompliance(ctx) {
  const { rep, source, idx } = ctx;
  if (!source.isDir(COMPLIANCE_DIR)) {
    rep.add(COMPLIANCE_DIR + "/", 0, 0, "CMP-05", `${COMPLIANCE_DIR}/ is missing - no category or ttp id is registered`, "a senior creates it with one _<category>_mapping.yaml per category");
    idx.compliance = new Map();
    return;
  }
  const files = checkFolder(ctx, COMPLIANCE_DIR, {
    allowed: (n) => MAP_RE.test(n),
    hint: "compliance files are named _<category>_mapping.yaml, e.g. _agent_mapping.yaml",
  });
  // Categories are declared by file name, so they are known even if a file fails to parse.
  for (const file of files) {
    const cat = file.split("/").pop().match(MAP_RE)[1];
    idx.cats.add(cat);
    idx.catFiles[cat] = file;
  }

  const ids = new Map();
  let complete = true;
  for (const file of files) {
    const cat = file.split("/").pop().match(MAP_RE)[1];
    const f = load(ctx, file);
    if (!f) { complete = false; continue; }
    const items = rootList(ctx, f, COMPLIANCE_ROOT, "CMP-01");
    if (!items) { complete = false; continue; }
    items.forEach((it, i) => {
      const where = "mapping " + (i + 1);
      if (!checkFields(ctx, f, it, ["id", "map"], where)) return;
      const ip = requireValue(ctx, f, it, "id", "CMP-01", where);
      if (ip) {
        const id = str(ip);
        if (ids.has(id)) rep.add(f.file, ...at(f, ip.value), "CMP-02", `id "${id}" is already registered at ${ids.get(id)}`, "each id is registered once across the whole compliance/ folder");
        else ids.set(id, `${f.file}:${f.pos(ip.value).line}`);
        if (!idRe(cat).test(id)) rep.add(f.file, ...at(f, ip.value), "CMP-06", `id "${id}" is not a ${cat}_NN id`, `_${cat}_mapping.yaml registers ${cat}_NN ids only (two or more digits)`);
      }
      const mp = get(it, "map");
      if (!mp) rep.add(f.file, ...at(f, it), "CMP-03", `${where}: "map" is required`, 'add map: with at least one framework, e.g. owasp_llm_top_10: ["LLM01"]');
      else if (!isMap(mp.value) || mp.value.items.length === 0) rep.add(f.file, ...at(f, mp.value || mp.key), "CMP-03", `${where}: map needs at least one framework`, 'e.g. owasp_llm_top_10: ["LLM01"]');
      else for (const fw of mp.value.items) {
        if (!isSeq(fw.value) || fw.value.items.length === 0) rep.add(f.file, ...at(f, fw.value || fw.key), "CMP-04", `framework "${fw.key.value}" lists no controls`, "list at least one, or remove the framework");
      }
    });
  }
  // A partial registry would make every unregistered-id check unreliable, so it is all or nothing.
  idx.compliance = complete ? ids : null;
}
