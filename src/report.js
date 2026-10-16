// Collects problems and prints them. A problem: {file, line, col, code, sev, msg, fix}.
// sev: "error" blocks (exit 1), "warn" asks for a second look, "info" explains a skipped check.

export class Reporter {
  constructor() {
    this.items = [];
  }
  add(file, line, col, code, msg, fix, sev = "error") {
    this.items.push({ file, line: line || 0, col: col || 0, code, sev, msg, fix: fix || "" });
  }
  sorted() {
    const rank = { info: 0, error: 1, warn: 2 };
    return [...this.items].sort((a, b) =>
      a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.col - b.col || rank[a.sev] - rank[b.sev]);
  }
  count(sev) {
    return this.items.filter((p) => p.sev === sev).length;
  }
  get errors() {
    return this.count("error");
  }
}

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
};
const plain = Object.fromEntries(Object.keys(C).map((k) => [k, (s) => s]));

export function formatText(items, { color = false, header = "" } = {}) {
  const c = color ? C : plain;
  const out = [];
  if (header) out.push(c.dim(header), "");
  let last = null;
  for (const p of items) {
    if (p.file !== last) {
      if (last !== null) out.push("");
      out.push(c.bold(c.cyan(p.file)));
      last = p.file;
    }
    const mark = p.sev === "error" ? c.red("✖") : p.sev === "warn" ? c.yellow("⚠") : c.dim("i");
    const loc = (p.line ? `${p.line}:${p.col}` : "-").padEnd(8);
    out.push(`  ${mark} ${loc}${c.magenta(p.code.padEnd(9))}${p.msg}`);
    if (p.fix) out.push(c.dim(`                     fix: ${p.fix}`));
  }
  const e = items.filter((p) => p.sev === "error").length;
  const w = items.filter((p) => p.sev === "warn").length;
  const i = items.filter((p) => p.sev === "info").length;
  if (items.length) out.push("");
  if (!e && !w && !i) out.push(c.green("✔ no problems"));
  else {
    const parts = [];
    if (e) parts.push(c.red(`${e} error${e > 1 ? "s" : ""}`));
    if (w) parts.push(c.yellow(`${w} warning${w > 1 ? "s" : ""}`));
    if (i) parts.push(c.dim(`${i} info`));
    out.push(parts.join("  ") + (e ? c.dim("  - commit blocked") : ""));
  }
  return out.join("\n");
}

export function formatJson(items) {
  return JSON.stringify(items, null, 2);
}

// GitHub Actions workflow commands: each problem becomes an annotation on the PR diff.
export function formatGithub(items, rootPrefix = "") {
  const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const escProp = (s) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  return items
    .map((p) => {
      const level = p.sev === "error" ? "error" : p.sev === "warn" ? "warning" : "notice";
      const props = [`file=${escProp(rootPrefix + p.file.replace(/\/$/, ""))}`];
      if (p.line) props.push(`line=${p.line}`, `col=${p.col}`);
      props.push(`title=${escProp(p.code)}`);
      return `::${level} ${props.join(",")}::${esc(p.msg + (p.fix ? " - fix: " + p.fix : ""))}`;
    })
    .join("\n");
}
