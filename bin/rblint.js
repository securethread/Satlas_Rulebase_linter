#!/usr/bin/env node
// rblint - rule base linter. Exit codes: 0 clean (or warnings/info only), 1 errors, 2 rblint itself failed.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WorktreeSource, GitSource, hasHead } from "../src/source.js";
import { lint, newProblems } from "../src/lint.js";
import { formatText, formatJson, formatGithub } from "../src/report.js";
import { fix } from "../src/fix.js";
import { scaffold } from "../src/scaffold.js";
import { resolveRoot, looksLikeRuleBase, versionAtLeast, CONFIG_FILE } from "../src/root.js";
import { installHook, uninstallHook } from "../src/hook.js";
import { REG_DIR, TREES } from "../src/config.js";

const PKG = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));

const HELP = `rblint ${PKG.version} - lint the SATLAS rule base

Usage (run anywhere inside the rule base repo; the rules folder is found automatically)
  rblint                        check the whole rule base (CI runs this)
  rblint --staged               check what is about to be committed; report only new problems
  rblint --fix                  fix indentation and spacing, then check
  rblint scaffold               senior: create category folders and _ttp.yaml stubs from compliance
  rblint install-hook           run rblint --staged before every commit in this repo
  rblint uninstall-hook         remove that hook
  rblint where                  show which folder rblint would check, and why

  Any command takes a folder to use instead of the detected one, e.g. rblint path/to/rules

Options
  --format text|json|github     output style (default text; github = PR annotations)
  --dry-run                     with --fix or scaffold: show changes, write nothing
  --force                       with install-hook: replace an existing pre-commit hook
  --no-color                    plain text output
  -h, --help | -v, --version

Finding the rules folder: the folder you name, else "root" in ${CONFIG_FILE}, else the current folder
or ./rules, else the git repo (top, top/rules, or a folder holding ${REG_DIR}/).

Exit codes: 0 clean or warnings only, 1 errors, 2 rblint could not run.`;

const COMMANDS = ["scaffold", "install-hook", "uninstall-hook", "where"];

function parseArgs(argv) {
  const o = { cmd: "lint", root: null, format: "text", staged: false, fix: false, dryRun: false, force: false, color: process.stdout.isTTY && !process.env.NO_COLOR };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.cmd = "help";
    else if (a === "-v" || a === "--version") o.cmd = "version";
    else if (a === "--staged") o.staged = true;
    else if (a === "--fix") o.fix = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--force") o.force = true;
    else if (a === "--no-color") o.color = false;
    else if (a === "--format") o.format = argv[++i];
    else if (a.startsWith("--format=")) o.format = a.slice(9);
    else if (a.startsWith("-")) throw new Error(`unknown option ${a} (see rblint --help)`);
    else rest.push(a);
  }
  if (COMMANDS.includes(rest[0]) && o.cmd === "lint") o.cmd = rest.shift();
  if (rest[0]) o.root = rest[0];
  if (!["text", "json", "github"].includes(o.format)) throw new Error("--format must be text, json or github");
  if (o.staged && o.fix) throw new Error("--fix rewrites the working tree; run it without --staged, then git add");
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  if (o.cmd === "help") { console.log(HELP); return 0; }
  if (o.cmd === "version") { console.log(PKG.version); return 0; }
  if (o.cmd === "install-hook") {
    const f = installHook(cwd, { force: o.force });
    console.log(`installed ${f}\nEvery commit in this repo now runs: rblint --staged`);
    return 0;
  }
  if (o.cmd === "uninstall-hook") {
    const f = uninstallHook(cwd);
    console.log(f ? `removed ${f}` : "no rblint hook installed");
    return 0;
  }

  const { root, config, how } = resolveRoot(cwd, o.root);
  if (config && config.data.minVersion && !versionAtLeast(PKG.version, config.data.minVersion)) {
    throw new Error(`this repo needs rblint ${config.data.minVersion} or newer (${config.file}); you have ${PKG.version}. Install the newer version and run again`);
  }
  if (!root) throw new Error(`no rule base found from ${cwd}. Run inside the rule base repo, pass the folder (rblint path/to/rules), or set "root" in ${CONFIG_FILE}`);
  if (!looksLikeRuleBase(root)) throw new Error(`${root} has none of ${REG_DIR}/, ${TREES.join("/, ")}/ - is that the rules folder?`);

  if (o.cmd === "where") {
    console.log(`${root}\n(${how === "argument" ? "folder given on the command line" : how === CONFIG_FILE ? "root in " + config.file : "detected"})`);
    return 0;
  }

  if (o.cmd === "scaffold") {
    const r = scaffold(root, { dryRun: o.dryRun });
    for (const c of r.created) console.log(`${o.dryRun ? "would create" : "created"}  ${c}`);
    for (const p of r.pending) console.log(`to do       ${p}`);
    if (!r.created.length && !r.pending.length) console.log("nothing to create - every declared category already has its folders");
    else if (r.created.length) console.log("\nFill in each empty name, then run rblint.");
    return 0;
  }

  if (o.fix) {
    const r = fix(root, { dryRun: o.dryRun });
    for (const c of r.changed) console.error(`${o.dryRun ? "would fix" : "fixed"}  ${c}`);
    for (const u of r.unfixable) console.error(`skipped ${u} (doesn't parse even after spacing fixes - see below)`);
    if (r.changed.length || r.unfixable.length) console.error("");
  }

  let items, header;
  const shown = path.relative(cwd, root) || ".";
  if (o.staged) {
    const after = lint(new GitSource(root, ":")).sorted();
    items = hasHead(root) ? newProblems(after, lint(new GitSource(root, "HEAD")).sorted()) : after;
    header = `rblint --staged ${shown}: ${items.length} new problem${items.length === 1 ? "" : "s"} in this commit`;
  } else {
    items = lint(new WorktreeSource(root)).sorted();
    header = "rblint " + shown;
  }

  if (o.format === "json") console.log(formatJson(items));
  else if (o.format === "github") {
    const base = process.env.GITHUB_WORKSPACE || cwd;
    const prefix = path.relative(base, root).split(path.sep).join("/");
    const text = formatGithub(items, prefix ? prefix + "/" : "");
    if (text) console.log(text);
    console.log(formatText(items, { color: false }));
  } else console.log(formatText(items, { color: o.color, header }));

  return items.some((p) => p.sev === "error") ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error("rblint: " + (e && e.message ? e.message : e));
  if (process.env.RBLINT_DEBUG) console.error(e);
  process.exitCode = 2;
}
