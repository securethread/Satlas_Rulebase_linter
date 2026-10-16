// RB-G01..G05: a folder's file.list against what is really in the folder.
import { FILE_LIST } from "./config.js";

// Explain why a name was refused, so the message is actionable.
export function whyBadName(n) {
  if (/\s/.test(n)) return "contains a space";
  if (/[A-Z]/.test(n)) return "contains capital letters";
  if (/^_/.test(n)) return "starts with _";
  if (/[^a-z0-9_.]/.test(n)) return "contains a special character";
  if (/__/.test(n)) return "has a double underscore";
  if (!/\.yaml$/.test(n)) return "is not a .yaml file";
  return "does not follow the pattern";
}

// Returns the folder's listed files that may be parsed (exist, allowed name), as paths.
export function checkFolder(ctx, dir, { allowed, hint }) {
  const { rep, source } = ctx;
  const listRel = dir + "/" + FILE_LIST;
  const present = source.list(dir).filter((e) => !e.dir && e.name !== FILE_LIST).map((e) => e.name);
  const raw = source.read(listRel);
  if (raw == null) {
    rep.add(dir + "/", 0, 0, "RB-G01", "missing file.list", `add ${listRel} naming every file in ${dir}/, one per line`);
    return [];
  }
  const seen = new Map();
  const ok = [];
  raw.split("\n").forEach((line, i) => {
    const name = line.trim();
    if (!name || name.startsWith("#")) return;
    const ln = i + 1;
    if (seen.has(name)) {
      rep.add(listRel, ln, 1, "RB-G04", `"${name}" is listed twice (first on line ${seen.get(name)})`, "remove the duplicate line");
      return;
    }
    seen.set(name, ln);
    if (name.includes("/")) {
      rep.add(listRel, ln, 1, "RB-G04", `"${name}" points outside ${dir}/`, "list only file names from this folder");
      return;
    }
    if (!present.includes(name)) {
      rep.add(listRel, ln, 1, "RB-G02", `"${name}" is listed but does not exist`, `create ${dir}/${name}, or remove the line`);
      return;
    }
    if (allowed && !allowed(name)) {
      rep.add(listRel, ln, 1, "RB-G05", `"${name}" is not an allowed file name here: it ${whyBadName(name)}`, hint);
      return; // never parsed, so a bad name can't produce follow-on errors
    }
    ok.push(dir + "/" + name);
  });
  for (const name of present) {
    if (!seen.has(name)) rep.add(dir + "/" + name, 0, 0, "RB-G03", `file must be listed in ${listRel}`, `add "${name}" to ${listRel}, or delete the file`);
  }
  return ok;
}
