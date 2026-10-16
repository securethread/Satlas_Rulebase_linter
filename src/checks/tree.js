// attack/, defence/, remediation/ - one folder per category, each with _ttp.yaml and <name>_sig.yaml files.
//
// Order inside one run (see lint.js): attack/<cat> is checked before defence/<cat> and
// remediation/<cat>, because their checks read what attack/<cat> declared:
//   idx.ttp[cat]           attack ttp ids               -> DEF-T06 / REM-T06, DEF-T07 / REM-T07
//   idx.names[cat]         attack signature name -> {at, id}  -> DEF-S11/S13, REM-S11/S15
//   idx.namesComplete[cat] false when an attack file failed, so target checks are skipped (RB-I01)
import { TREES, TTP, SIG, SIG_RE, TTP_FILE, FILE_LIST, SEVERITIES, INDUSTRIES_FILE, LIST_FIELDS, idRe } from "../config.js";
import { checkFolder } from "../filelist.js";
import { load, rootList, checkFields, requireValue, get, str, at, isSeq, isScalar } from "../yamlfile.js";

const SIG_HINT = "expected _ttp.yaml or <name>_sig.yaml: lowercase letters, digits and single underscores, e.g. suman_dutta_sig.yaml or suman_dutta_01_sig.yaml";

// The category an id belongs to = the declared category whose name prefixes it (longest wins,
// so "owasp_top_10_01" is owasp_top_10 even if a category "owasp" also exists). null if none.
export function ownerCat(ctx, id) {
  let best = null;
  for (const c of ctx.idx.cats) {
    if (id.startsWith(c + "_") && (!best || c.length > best.length)) best = c;
  }
  return best;
}

// null when the id is a valid id of this folder's category, else a message saying why not.
// Exact match, not a prefix test: "mcp_top_10_01" is not an id of category "mcp".
function categoryProblem(ctx, id, cat) {
  const owner = ownerCat(ctx, id);
  if (owner && owner !== cat) return `id "${id}" belongs to category "${owner}", not "${cat}"`;
  if (!idRe(cat).test(id)) return `id "${id}" is not a ${cat}_NN id`;
  return null;
}

// Compliance decides what an id may be. Returns true when the id is registered (or the registry is unreadable).
function registered(ctx, f, node, id, code, where, cat) {
  const reg = ctx.idx.compliance;
  if (!reg || reg.has(id)) return true;
  const near = [...reg.keys()].filter((x) => ownerCat(ctx, x) === cat).slice(0, 4);
  const owner = ownerCat(ctx, id);
  const fix = owner && idRe(owner).test(id)
    ? `a senior registers ${id} in _${owner}_mapping.yaml first, or use a registered id${near.length ? " (" + near.join(", ") + ")" : ""}`
    : `use a registered id${near.length ? ": " + near.join(", ") : ` - _${cat}_mapping.yaml registers none yet`}`;
  ctx.rep.add(f.file, ...at(f, node), code, `${where}id "${id}" is not registered in compliance`, fix);
  return false;
}

// <tree>/<cat>/_ttp.yaml. Returns the set of declared ids, or null when the file can't be used.
function checkTtp(ctx, file, tree, cat) {
  const { rep, idx } = ctx;
  const spec = TTP[tree];
  const P = spec.prefix;
  const f = load(ctx, file);
  if (!f) return null;
  const items = rootList(ctx, f, "ttps", "RB-G09");
  if (!items) return null;
  const ids = new Map(), names = new Map();
  items.forEach((it, i) => {
    const where = "ttp " + (i + 1);
    if (!checkFields(ctx, f, it, spec.allowed, where)) return;
    const ip = requireValue(ctx, f, it, "id", P + "01", where);
    if (ip) {
      const id = str(ip);
      if (ids.has(id)) rep.add(f.file, ...at(f, ip.value), P + "02", `id "${id}" is already declared on line ${ids.get(id)}`, `each ttp id is declared once in ${tree}/${cat}/_ttp.yaml`);
      else ids.set(id, f.pos(ip.value).line);
      const reg = registered(ctx, f, ip.value, id, P + "09", "", cat);
      const wrong = categoryProblem(ctx, id, cat);
      if (wrong) rep.add(f.file, ...at(f, ip.value), P + "05", wrong, `ttp ids in ${tree}/${cat}/ are ${cat}_NN - check the id and the folder`);
      if (reg && !wrong && tree !== "attack" && idx.ttp[cat] && !idx.ttp[cat].has(id)) {
        rep.add(f.file, ...at(f, ip.value), P + "06", `id "${id}" is registered but attack/${cat}/_ttp.yaml does not declare it`, "check the id, or declare the attack ttp first", "warn");
      }
    }
    const np = requireValue(ctx, f, it, "name", P + "03", where);
    if (np && tree === "attack") {
      const key = str(np).toLowerCase();
      if (names.has(key)) rep.add(f.file, ...at(f, np.value), P + "04", `name "${str(np)}" is already used on line ${names.get(key)}`, `ttp names are unique in ${tree}/${cat}/`);
      else names.set(key, f.pos(np.value).line);
    }
    if (tree === "attack") {
      const cp = requireValue(ctx, f, it, "compliance", "ATK-T07", where);
      // when compliance repeats the ttp's own id, T09 above already covers it
      if (cp && idx.compliance && !idx.compliance.has(str(cp)) && !(ip && str(cp) === str(ip))) {
        rep.add(f.file, ...at(f, cp.value), "ATK-T08", `compliance "${str(cp)}" is not a registered mapping id`, "use a registered id, or ask a senior to register it");
      }
    }
  });
  // Coverage: every attack ttp should have a defence and a remediation ttp (warning only).
  if (tree !== "attack" && idx.ttp[cat]) {
    for (const id of idx.ttp[cat]) {
      if (!ids.has(id)) rep.add(f.file, 1, 1, P + "07", `attack ttp "${id}" has no entry in ${tree}/${cat}/_ttp.yaml`, `add "- id: ${id}" with its name`, "warn");
    }
  }
  return new Set(ids.keys());
}

// <tree>/<cat>/<name>_sig.yaml. Returns false when the file can't be used.
function checkSig(ctx, file, tree, cat, ttpIds) {
  const { rep, idx } = ctx;
  const spec = SIG[tree];
  const P = spec.prefix;
  const f = load(ctx, file);
  if (!f) return false;
  const items = rootList(ctx, f, spec.root, P + "01");
  if (!items) return false;
  // defence/remediation targets are checked only against a complete set of attack names
  const nameIdx = tree === "attack" ? idx.names[cat] : idx.namesComplete[cat] ? idx.names[cat] : null;
  const local = { target: new Map(), title: new Map() };
  items.forEach((it, i) => {
    const where = spec.root.replace(/s$/, "") + " " + (i + 1);
    if (!checkFields(ctx, f, it, spec.allowed, where)) return;
    const got = {};
    spec.required.forEach((k, j) => {
      got[k] = requireValue(ctx, f, it, k, P + String(j + 2).padStart(2, "0"), where);
    });
    // required fields that must be a non-empty list (e.g. remediation mitigation_steps)
    for (const k of LIST_FIELDS[P] || []) {
      const p = got[k];
      if (p && (!isSeq(p.value) || p.value.items.length === 0)) {
        rep.add(f.file, ...at(f, p.value || p.key), P + "14", `${where}: "${k}" must be a non-empty list`, `write "${k}:" then one "- step" per line`);
      }
    }

    // id: repeats freely (many prompts per ttp), but must be registered, in this category, and declared
    let idOk = false;
    if (got.id) {
      const id = str(got.id);
      const reg = registered(ctx, f, got.id.value, id, P + "09", where + ": ", cat);
      const wrong = reg && categoryProblem(ctx, id, cat);
      if (wrong) rep.add(f.file, ...at(f, got.id.value), P + "08", `${where}: ${wrong}`, `ids in ${tree}/${cat}/ are ${cat}_NN - check the id and the folder`);
      else if (reg && ttpIds && !ttpIds.has(id)) rep.add(f.file, ...at(f, got.id.value), P + "10", `${where}: id "${id}" is not declared in ${tree}/${cat}/_ttp.yaml`, "the id names the ttp this entry belongs to");
      idOk = reg && !wrong;
    }

    if (tree === "attack") {
      if (got.name) {
        const n = str(got.name);
        if (nameIdx.has(n)) rep.add(f.file, ...at(f, got.name.value), "ATK-S11", `name "${n}" is already used at ${nameIdx.get(n).at}`, `signature names are unique across attack/${cat}/, compared as the full string`);
        else nameIdx.set(n, { at: `${f.file}:${f.pos(got.name.value).line}`, id: got.id ? str(got.id) : null });
      }
      if (got.severity && !SEVERITIES.includes(str(got.severity))) {
        rep.add(f.file, ...at(f, got.severity.value), "ATK-S12", `severity "${str(got.severity)}" is not allowed`, "use one of: " + SEVERITIES.join(", "));
      }
      const ap = get(it, "agent");
      if (!ap) rep.add(f.file, ...at(f, it), "ATK-S13", `${where}: "agent" is required (an empty list [] is fine)`, "add agent: [] or agent: [Banking]");
      else if (ap.value && !isSeq(ap.value) && !(isScalar(ap.value) && ap.value.value == null)) {
        rep.add(f.file, ...at(f, ap.value), "ATK-S13", `${where}: agent must be a list`, "agent: [Banking, Banking.Loan]");
      } else if (isSeq(ap.value)) {
        for (const a of ap.value.items) {
          if (!isScalar(a)) rep.add(f.file, ...at(f, a), "ATK-S14", `${where}: each agent value is a name, not a block`, "agent: [Banking, Banking.Loan]");
          else if (idx.industries && !idx.industries.has(String(a.value))) rep.add(f.file, ...at(f, a), "ATK-S14", `agent "${a.value}" is not defined in ${INDUSTRIES_FILE}`, "use a defined name or Parent.Sub, e.g. Banking or Banking.Loan");
        }
      }
      return;
    }

    if (got.target) {
      const t = str(got.target);
      const hit = nameIdx && nameIdx.get(t);
      if (nameIdx && !hit) rep.add(f.file, ...at(f, got.target.value), P + "11", `target "${t}" is not a signature name in attack/${cat}/`, "copy the exact name from an attack signature");
      // the entry's id must be the ttp of the attack it answers
      const code = tree === "defence" ? "DEF-S13" : "REM-S15";
      if (hit && idOk && hit.id && hit.id !== str(got.id)) {
        rep.add(f.file, ...at(f, got.id.value), code, `${where}: id "${str(got.id)}" but its target "${t}" is an attack on "${hit.id}"`, `set id: ${hit.id}, or target an attack signature of ${str(got.id)}`);
      }
      if (tree === "remediation") {
        if (local.target.has(t)) rep.add(f.file, ...at(f, got.target.value), "REM-S12", `target "${t}" is already remediated in this file (line ${local.target.get(t)})`, "one remediation per attack per author - merge them");
        else local.target.set(t, f.pos(got.target.value).line);
      }
    }
    if (tree === "defence") {
      const np = get(it, "name");
      if (np && str(np)) {
        const n = str(np);
        const seen = idx.defNames[cat] || (idx.defNames[cat] = new Map());
        if (seen.has(n)) rep.add(f.file, ...at(f, np.value), "DEF-S14", `name "${n}" is already used at ${seen.get(n)}`, `detection names are unique across defence/${cat}/`);
        else seen.set(n, `${f.file}:${f.pos(np.value).line}`);
      }
      if (got.refusal_regex) {
        const msg = regexProblem(str(got.refusal_regex));
        if (msg) rep.add(f.file, ...at(f, got.refusal_regex.value), "DEF-S12", "refusal_regex does not compile", msg, "warn");
      }
    }
    if (tree === "remediation" && got.title) {
      const t = str(got.title).toLowerCase();
      if (local.title.has(t)) rep.add(f.file, ...at(f, got.title.value), "REM-S13", `title is already used in this file (line ${local.title.get(t)})`, "give each remediation its own title");
      else local.title.set(t, f.pos(got.title.value).line);
    }
  });
  return true;
}

// The scan engine writes patterns in Python style. JavaScript is used to compile them, so translate
// the Python-only spellings first: leading global flags (?i), named groups (?P<n>...), (?P=n).
export function regexProblem(src) {
  let flags = "";
  let re = String(src).replace(/^\(\?([aiLmsux]+)\)/, (_, f) => { flags = f; return ""; });
  if (/\(\?[aiLmsux]+\)/.test(re)) return "global flags like (?i) must be at the very start of the pattern";
  re = re.replace(/\(\?P</g, "(?<").replace(/\(\?P=(\w+)\)/g, "\\k<$1>");
  if (flags.includes("x")) return null; // verbose patterns (comments, free spacing) have no JS equivalent
  try {
    new RegExp(re, [...new Set(flags.replace(/[aLux]/g, ""))].join(""));
    return null;
  } catch (e) {
    return e.message.replace(/^Invalid regular expression: /, "");
  }
}

export function checkTrees(ctx) {
  const { rep, source, idx } = ctx;
  idx.defNames = {};
  for (const tree of TREES) {
    if (!source.isDir(tree)) continue;
    for (const e of source.list(tree)) {
      if (!e.dir) rep.add(`${tree}/${e.name}`, 0, 0, "RB-G14", `files don't belong directly in ${tree}/`, `move it into a category folder, e.g. ${tree}/agent/`);
    }
    const cats = source.list(tree).filter((e) => e.dir).map((e) => e.name).sort();
    for (const cat of cats) {
      const dir = `${tree}/${cat}`;
      if (!idx.cats.has(cat)) rep.add(dir + "/", 0, 0, "RB-G13", `category "${cat}" is not declared in compliance`, `a senior adds compliance/_${cat}_mapping.yaml (and lists it) before ${dir}/ can exist`);
      if (tree !== "attack" && !source.isDir("attack/" + cat)) rep.add(dir + "/", 0, 0, "RB-G10", `${dir}/ has no matching attack/${cat}/`, "categories are created in attack/ first");
      for (const sub of source.list(dir).filter((x) => x.dir)) {
        rep.add(`${dir}/${sub.name}/`, 0, 0, "RB-G14", `sub-folders are not allowed inside ${dir}/`, "keep _ttp.yaml and signature files directly in the category folder");
      }
      const hasList = source.read(`${dir}/${FILE_LIST}`) != null;
      const files = checkFolder(ctx, dir, { allowed: (n) => n === TTP_FILE || SIG_RE.test(n), hint: SIG_HINT });
      const ttpFile = files.find((p) => p.endsWith("/" + TTP_FILE));
      if (hasList && !ttpFile) rep.add(dir + "/", 0, 0, "RB-G11", `${dir}/file.list does not include _ttp.yaml`, "every category has exactly one _ttp.yaml");
      const ids = ttpFile ? checkTtp(ctx, ttpFile, tree, cat) : null;
      if (ttpFile && !ids) rep.add(dir + "/", 0, 0, "RB-I01", "id checks against _ttp.yaml are skipped until it parses", "fix _ttp.yaml first, then run again", "info");
      if (tree === "attack") {
        idx.ttp[cat] = ids;
        idx.names[cat] = new Map();
      }
      // without a file.list nothing in the folder is read, so the attack name index is incomplete
      let allParsed = hasList;
      for (const p of files) if (p !== ttpFile && !checkSig(ctx, p, tree, cat, ids)) allParsed = false;
      if (tree === "attack") {
        idx.namesComplete[cat] = allParsed;
        if (!allParsed) rep.add(dir + "/", 0, 0, "RB-I01", `defence and remediation target checks for "${cat}" are skipped until every attack signature file is listed and parses`, "fix attack/" + cat + "/ first", "info");
      }
    }
  }
  // Registry coverage (warnings): declared categories with no attack folder, registered ids no
  // attack ttp declares. Only when the registry and the attack _ttp.yaml are readable.
  if (idx.compliance) {
    for (const cat of idx.cats) {
      if (!source.isDir("attack/" + cat)) rep.add(idx.catFiles[cat] || "", 0, 0, "CMP-07", `category "${cat}" is declared but attack/${cat}/ does not exist`, "run: rblint scaffold", "warn");
    }
    for (const [id, loc] of idx.compliance) {
      const cat = ownerCat(ctx, id);
      if (!cat || !idx.ttp[cat]) continue;
      if (!idx.ttp[cat].has(id)) {
        const [file, line] = loc.split(/:(?=\d+$)/);
        rep.add(file, Number(line), 1, "CMP-08", `id "${id}" is registered but attack/${cat}/_ttp.yaml does not declare it`, "add it to the attack _ttp.yaml, or remove the mapping", "warn");
      }
    }
  }
}
