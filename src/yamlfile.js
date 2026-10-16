// Common checks for every YAML file: RB-G12 (space after colon), RB-G06 (parses), RB-G07 (formatted).
import YAML, { LineCounter, Parser, CST, isMap, isSeq, isScalar } from "yaml";
import { isDeepStrictEqual } from "util";
import { FORMAT } from "./config.js";

// "key:value" with no space, at the start of a line or after "- ". A "/" right after the colon
// (https://...) is a value, not a slip.
const SLIP_RE = /^(\s*(?:- )?)([A-Za-z_][\w-]*):(?=[^\s/])/;

// Lines that are the inside of a multi-line text value (a "|" / ">" block, or a quoted string that
// spans lines). Text there is data - an attack prompt may well contain "User:hi" - so it is never
// reported as a missing space and never rewritten by --fix. Uses the YAML lexer, so it works even
// when the file does not parse yet. Returns a Set of 1-based line numbers.
export function valueLines(src) {
  const ranges = [];
  try {
    for (const tok of new Parser().parse(src)) {
      CST.visit(tok, (item) => {
        for (const t of [item.key, item.value]) {
          if (!t || typeof t.offset !== "number") continue;
          if (t.type === "block-scalar") {
            const head = (t.props || []).reduce((n, p) => n + (p.source || "").length, 0);
            ranges.push([t.offset, t.offset + head + (t.source || "").length]);
          } else if (t.type === "single-quoted-scalar" || t.type === "double-quoted-scalar") {
            ranges.push([t.offset, t.offset + (t.source || "").length]);
          }
        }
      });
    }
  } catch {
    return new Set();
  }
  const lines = new Set();
  if (!ranges.length) return lines;
  let off = 0;
  src.split("\n").forEach((line, i) => {
    // a line belongs to a value when it starts strictly inside a range (the first line holds the key)
    if (ranges.some(([a, b]) => off > a && off < b)) lines.add(i + 1);
    off += line.length + 1;
  });
  return lines;
}

export function spaceSlips(src) {
  const out = [];
  const inside = valueLines(src);
  src.split("\n").forEach((line, i) => {
    if (/^\s*#/.test(line) || inside.has(i + 1)) return;
    const m = line.match(SLIP_RE);
    if (m) out.push({ line: i + 1, col: m[1].length + 1, key: m[2], rest: line.slice(m[0].length).trim() });
  });
  return out;
}

function parse(src) {
  const lc = new LineCounter();
  const doc = YAML.parseDocument(src, { lineCounter: lc, prettyErrors: false, uniqueKeys: true });
  return { doc, lc };
}

// Returns { file, doc, root, pos } or null when the file can't be used for schema checks.
export function load(ctx, rel) {
  let src = ctx.source.read(rel);
  if (src == null) return null;
  const rep = ctx.rep;
  if (src.includes("\r")) {
    rep.add(rel, 1, 1, "RB-G07", "file uses Windows (CRLF) line endings", "run: rblint --fix, and set git config core.autocrlf input (or add *.yaml text eol=lf to .gitattributes)");
    src = src.replace(/\r\n?/g, "\n");
  }
  if (src.charCodeAt(0) === 0xfeff) {
    rep.add(rel, 1, 1, "RB-G07", "file starts with a byte-order mark (BOM)", "save the file as UTF-8 without BOM (rblint --fix does this)");
    src = src.slice(1);
  }
  const slips = spaceSlips(src);
  for (const s of slips) {
    rep.add(rel, s.line, s.col, "RB-G12", `missing space after "${s.key}:"`, `write "${s.key}: ${s.rest}" (rblint --fix does this)`);
  }
  if (/^\t+/m.test(src)) {
    const line = src.split("\n").findIndex((l) => /^\t/.test(l)) + 1;
    rep.add(rel, line, 1, "RB-G06", "line is indented with a tab", "indent with spaces only (rblint --fix does this)");
    return null;
  }
  const { doc, lc } = parse(src);
  if (doc.errors.length) {
    const dup = doc.errors.find((e) => e.code === "DUPLICATE_KEY");
    if (dup) {
      const p = lc.linePos(dup.pos[0]);
      const key = (src.split("\n")[p.line - 1] || "").trim().split(":")[0];
      rep.add(rel, p.line, p.col, "RB-G06",
        `key "${key}" appears twice in the same mapping - the file holds several entries as separate blocks`,
        'put the entries in one list under the root key (ttps:, mappings:, ...), each starting with "- id:"');
      return null;
    }
    if (slips.length) return null; // the space slips above are the cause - don't repeat them as parse errors
    for (const e of doc.errors.slice(0, 1)) { // the first error is the cause; the rest are usually echoes
      const p = lc.linePos(e.pos[0]);
      rep.add(rel, p.line, p.col, "RB-G06", e.message.split("\n")[0].replace(/ at line \d+, column \d+:?$/, ""), "fix the YAML syntax here");
    }
    return null;
  }
  const formatted = doc.toString(FORMAT);
  if (trimEnd(formatted) !== trimEnd(src)) {
    const a = src.split("\n"), b = formatted.split("\n");
    let i = 0;
    while (i < a.length && a[i].replace(/\s+$/, "") === (b[i] || "").replace(/\s+$/, "")) i++;
    rep.add(rel, i + 1, 1, "RB-G07", "indentation or spacing differs from the standard", "run: rblint --fix");
  }
  const pos = (node) => (node && node.range ? lc.linePos(node.range[0]) : { line: 1, col: 1 });
  return { file: rel, doc, root: doc.contents, pos, lines: src.split("\n") };
}

const trimEnd = (s) => s.replace(/\s+$/, "");

// --fix: returns the fixed text, or null when the file can't be fixed safely.
// Only whitespace changes: line endings, BOM, a space after "key:", tabs to spaces, re-indentation.
// Text inside multi-line values is never touched. When the original already parses, the parsed
// data before and after must be identical, or the fix is refused - so --fix can never change a value.
export function fixText(src) {
  let text = src.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
  const inside = valueLines(text);
  text = text.split("\n").map((line, i) => {
    if (inside.has(i + 1)) return line;
    line = line.replace(/^\t+/, (t) => "  ".repeat(t.length));
    return /^\s*#/.test(line) ? line : line.replace(SLIP_RE, "$1$2: ");
  }).join("\n");
  const { doc } = parse(text);
  if (doc.errors.length) return null;
  const before = parse(src.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n")).doc;
  const out = trimEnd(doc.toString(FORMAT)) + "\n";
  const after = parse(out).doc;
  if (!before.errors.length && !isDeepStrictEqual(before.toJS(), after.toJS())) return null;
  if (!isDeepStrictEqual(doc.toJS(), after.toJS())) return null;
  return out;
}

// ── schema helpers ─────────────────────────────────────────────────────────
export { isMap, isSeq, isScalar };

export function get(map, key) {
  return isMap(map) ? map.items.find((p) => p.key && p.key.value === key) : undefined;
}
export function str(pair) {
  if (!pair) return "";
  const v = isScalar(pair.value) ? pair.value.value : pair.value;
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}
export function at(f, node) {
  const p = f.pos(node);
  return [p.line, p.col];
}

// The file's single root key, holding a list. Returns the list items or null.
export function rootList(ctx, f, key, missingCode) {
  const rep = ctx.rep;
  if (!isMap(f.root)) {
    rep.add(f.file, 1, 1, "RB-G09", `the file must start with "${key}:" holding a list`, `write "${key}:" then one "- ..." entry per item`);
    return null;
  }
  for (const p of f.root.items) {
    if (p.key.value !== key) rep.add(f.file, ...at(f, p.key), "RB-G08", `unknown top-level key "${p.key.value}"`, `only "${key}:" belongs at the top of this file`);
  }
  const p = get(f.root, key);
  if (!p) {
    rep.add(f.file, 1, 1, missingCode, `missing "${key}:" list`, `add "${key}:" with at least one entry`);
    return null;
  }
  if (!isSeq(p.value)) {
    rep.add(f.file, ...at(f, p.value || p.key), "RB-G09", `"${key}" must be a list`, 'write each entry as "- field: value"');
    return null;
  }
  return p.value.items;
}

export function checkFields(ctx, f, item, allowed, where) {
  if (!isMap(item)) {
    ctx.rep.add(f.file, ...at(f, item), "RB-G09", `${where}: entry must be "field: value" pairs`, "check the indentation and the space after each colon");
    return false;
  }
  for (const p of item.items) {
    if (!allowed.includes(p.key.value)) ctx.rep.add(f.file, ...at(f, p.key), "RB-G08", `${where}: unknown field "${p.key.value}"`, "allowed: " + allowed.join(", "));
  }
  return true;
}

// Required field with a non-empty value. Returns the pair or null.
export function requireValue(ctx, f, item, key, code, where) {
  const p = get(item, key);
  if (!p) {
    ctx.rep.add(f.file, ...at(f, item), code, `${where}: "${key}" is required`, `add "${key}:"`);
    return null;
  }
  if (str(p) === "") {
    // "name: #foo..." - YAML reads #foo as a comment, so the value is empty. Common with ids/names.
    const ln = f.lines && f.lines[f.pos(p.key).line - 1];
    const commented = ln && new RegExp(`\\b${key}:\\s*#`).test(ln);
    const fix = commented
      ? `the value starts with "#", which YAML reads as a comment - quote it, e.g. ${key}: "#..."`
      : `give "${key}" a value`;
    ctx.rep.add(f.file, ...at(f, p.value || p.key), code, `${where}: "${key}" is empty`, fix);
    return null;
  }
  return p;
}
