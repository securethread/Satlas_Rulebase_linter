// The command line, git integration (--staged, hook), scaffold and rules-folder detection.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { spawnSync } from "child_process";
import path from "path";
import { copy, cli, git, repo, read, write, replace } from "./helpers.js";

const PKG = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const AS = "attack/agent/sb_sig.yaml";
const KS = "attack/agent/ka_sig.yaml";

test("exit 0 on a clean rule base, 1 on errors, 2 when it can't run", () => {
  const root = copy();
  assert.equal(cli([root]).code, 0);
  replace(root, AS, "    severity: critical\n", "    severity: severe\n");
  const r = cli([root]);
  assert.equal(r.code, 1);
  assert.match(r.out, /ATK-S12/);
  assert.equal(cli([path.join(root, "nope")]).code, 2);
  assert.equal(cli(["--bogus"]).code, 2);
});

test("--format json and --format github", () => {
  const root = copy();
  replace(root, AS, "    severity: critical\n", "    severity: severe\n");
  const j = JSON.parse(cli([root, "--format", "json"]).out);
  assert.equal(j[0].code, "ATK-S12");
  assert.match(cli([root, "--format", "github"], { env: { GITHUB_WORKSPACE: path.dirname(root) } }).out, /^::error file=rules\/attack\/agent\/sb_sig\.yaml,line=\d+/m);
});

test("--version, --help, where", () => {
  assert.equal(cli(["--version"]).out.trim(), PKG.version);
  assert.match(cli(["--help"]).out, /rblint --staged/);
  const root = copy();
  assert.match(cli(["where"], { cwd: root }).out, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("rules folder is found from the repo top and from .rblintrc.json; minVersion is enforced", () => {
  const { top, rules } = repo();
  assert.equal(cli([], { cwd: top }).code, 0);
  write(top, ".rblintrc.json", JSON.stringify({ root: "rules", minVersion: "99.0.0" }));
  const r = cli([], { cwd: top });
  assert.equal(r.code, 2);
  assert.match(r.err, /needs rblint 99\.0\.0/);
  write(top, ".rblintrc.json", JSON.stringify({ root: "rules", minVersion: PKG.version }));
  assert.equal(cli([], { cwd: path.join(rules, "attack") }).code, 0);
});

test("a repo folder on the command line follows its .rblintrc.json", () => {
  const { top } = repo();
  write(top, ".rblintrc.json", JSON.stringify({ root: "rules", minVersion: PKG.version }));
  const r = cli([top]);
  assert.equal(r.code, 0, r.out + r.err);
});

test("--staged reports only what the commit adds, even when lines move", () => {
  const { top, rules } = repo();
  // an old problem already on HEAD: ka_sig reuses a name from sb_sig
  replace(rules, KS, "name: agent_01.indprominjec01Ka.001.ka", "name: agent_01.directGoalOverride.001.sb");
  git(top, "commit", "-qam", "someone else's mistake");
  // a clean new signature at the top of sb_sig shifts every line the old message points at
  replace(rules, AS, "signatures:\n", "signatures:\n  - id: agent_01\n    name: agent_01.brandNew.001.sb\n    severity: low\n    agent: []\n    prompt: hi\n    attack: x\n");
  git(top, "add", "-A");
  let r = cli(["--staged"], { cwd: top });
  assert.equal(r.code, 0, r.out);
  // a real new problem is still caught
  replace(rules, AS, "    severity: low\n", "    severity: lowest\n");
  git(top, "add", "-A");
  r = cli(["--staged"], { cwd: top });
  assert.equal(r.code, 1);
  assert.match(r.out, /ATK-S12/);
  assert.doesNotMatch(r.out, /ATK-S11/);
});

test("--staged checks the staged version, not unsaved edits", () => {
  const { top, rules } = repo();
  replace(rules, AS, "    severity: critical\n", "    severity: severe\n"); // not staged
  assert.equal(cli(["--staged"], { cwd: top }).code, 0);
});

test("install-hook blocks a bad commit; uninstall-hook removes it; foreign hooks are kept", () => {
  const { top, rules } = repo();
  const bin = path.join(top, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "rblint"), `#!/bin/sh\nexec "${process.execPath}" "${path.resolve("bin/rblint.js")}" "$@"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH };
  const commit = (msg) => spawnSync("git", ["commit", "-qm", msg], { cwd: top, env, encoding: "utf8" });
  assert.equal(cli(["install-hook"], { cwd: top }).code, 0);
  replace(rules, AS, "    severity: critical\n", "    severity: severe\n");
  git(top, "add", "-A");
  let r = commit("bad");
  assert.notEqual(r.status, 0, "hook should block");
  assert.match(r.stdout + r.stderr, /ATK-S12/);
  replace(rules, AS, "    severity: severe\n", "    severity: high\n");
  git(top, "add", "-A");
  r = commit("good");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(cli(["uninstall-hook"], { cwd: top }).code, 0);
  write(top, ".git/hooks/pre-commit", "#!/bin/sh\necho mine\n");
  assert.equal(cli(["install-hook"], { cwd: top }).code, 2);
  assert.equal(read(top, ".git/hooks/pre-commit"), "#!/bin/sh\necho mine\n");
});

test("scaffold creates every declared category (including underscores) and never overwrites", () => {
  const root = copy();
  for (const t of ["attack", "defence", "remediation"]) fs.rmSync(path.join(root, t), { recursive: true });
  const r = cli(["scaffold", root]);
  assert.equal(r.code, 0);
  assert.match(r.out, /created\s+attack\/owasp_top_10\/_ttp\.yaml/);
  assert.match(read(root, "attack/owasp_top_10/_ttp.yaml"), /id: owasp_top_10_01/);
  // names are empty on purpose, so the rule base fails until someone fills them in
  assert.equal(cli([root]).code, 1);
  assert.match(cli(["scaffold", root]).out, /nothing to create/);
});
