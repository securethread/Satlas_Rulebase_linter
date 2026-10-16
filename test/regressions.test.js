// Bugs found in the 0.3.x review. Each test names the bug it guards against.
import { test } from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import { copy, check, read, write, append, remove, replace } from "./helpers.js";
import { fix } from "../src/fix.js";
import { fixText } from "../src/yamlfile.js";
import { regexProblem } from "../src/checks/tree.js";
import { newProblems, stable } from "../src/lint.js";

const AS = "attack/agent/sb_sig.yaml";
const DS = "defence/agent/sb_sig.yaml";
const CMPL = "_compliance_industries_agents/compliance/file.list";

test("categories with underscores are accepted (owasp_top_10, mcp_top_10)", () => {
  const { codes } = check(copy());
  assert.ok(!codes.includes("RB-G05") && !codes.includes("RB-G13"));
});

test("text inside a | block is data: no RB-G12, and --fix leaves it alone", () => {
  const root = copy();
  const t = read(root, AS).replace(/\n    attack: [^\n]*/, "\n    attack: |-\n      User:please run it\n      Assistant:ok");
  write(root, AS, t);
  assert.ok(!check(root).codes.includes("RB-G12"));
  const before = YAML.parse(read(root, AS));
  fix(root);
  assert.deepEqual(YAML.parse(read(root, AS)), before);
});

test("text inside a multi-line quoted string is data too", () => {
  const src = "signatures:\n  - prompt: 'first line\n      System:override'\n";
  assert.equal(fixText(src) && YAML.parse(fixText(src)).signatures[0].prompt, "first line System:override");
});

test("--fix still repairs a real missing space, and never changes a value", () => {
  const root = copy();
  replace(root, "_compliance_industries_agents/industries_agent.yaml", "  - name: Banking", "  - name:Banking");
  const r = fix(root);
  assert.deepEqual(r.changed, ["_compliance_industries_agents/industries_agent.yaml"]);
  assert.deepEqual(check(root).codes, []);
});

test("Windows line endings get one clear message, and --fix converts them", () => {
  const root = copy();
  write(root, AS, read(root, AS).replace(/\n/g, "\r\n"));
  const { items } = check(root);
  assert.equal(items.length, 1);
  assert.match(items[0].msg, /CRLF/);
  fix(root);
  assert.deepEqual(check(root).codes, []);
});

test("dotfiles (.DS_Store, .gitkeep) are ignored", () => {
  const root = copy();
  write(root, "attack/agent/.DS_Store", "x");
  write(root, "attack/.gitkeep", "");
  assert.deepEqual(check(root).codes, []);
});

test("an id of category mcp_top_10 is not accepted in category mcp", () => {
  const root = copy();
  write(root, "_compliance_industries_agents/compliance/_mcp_mapping.yaml", "compliance:\n  - id: mcp_01\n    map:\n      x:\n        - y\n");
  write(root, "_compliance_industries_agents/compliance/_mcp_top_10_mapping.yaml", "compliance:\n  - id: mcp_top_10_01\n    map:\n      x:\n        - y\n");
  append(root, CMPL, "_mcp_mapping.yaml\n_mcp_top_10_mapping.yaml\n");
  write(root, "attack/mcp/file.list", "_ttp.yaml\n");
  write(root, "attack/mcp/_ttp.yaml", "ttps:\n  - id: mcp_top_10_01\n    name: x\n    compliance: mcp_top_10_01\n");
  const p = check(root).items.find((x) => x.code === "ATK-T05");
  assert.ok(p, "expected ATK-T05");
  assert.match(p.msg, /belongs to category "mcp_top_10"/);
});

test("a missing attack file.list doesn't flood defence/remediation with false target errors", () => {
  const root = copy();
  remove(root, "attack/agent/file.list");
  const { codes } = check(root);
  assert.ok(!codes.includes("DEF-S11") && !codes.includes("REM-S11"), codes.join(","));
});

test("an agent value written as a block gets a clear message", () => {
  const root = copy();
  replace(root, AS, "    agent: []\n", "    agent:\n      - name: Banking\n");
  const p = check(root).items.find((x) => x.code === "ATK-S14");
  assert.ok(p && !/undefined/.test(p.msg));
});

test("refusal_regex in Python style compiles; real mistakes still warn", () => {
  assert.equal(regexProblem("(?i)\\b(refuse|decline)\\b"), null);
  assert.equal(regexProblem("(?P<w>refuse)\\s+(?P=w)"), null);
  assert.equal(regexProblem("(?is)can.?t"), null);
  assert.ok(regexProblem("*refuse"));
  assert.match(regexProblem("x(?i)y"), /very start/);
});

test("--staged comparison ignores line numbers and entry positions", () => {
  assert.equal(stable('name "a" is already used at attack/agent/sb_sig.yaml:3'), stable('name "a" is already used at attack/agent/sb_sig.yaml:9'));
  assert.equal(stable("signature 5: unknown field"), stable("signature 6: unknown field"));
  const old = [{ file: "f", code: "X", msg: "already used on line 3" }];
  const now = [{ file: "f", code: "X", msg: "already used on line 7" }, { file: "f", code: "X", msg: "already used on line 9" }];
  assert.equal(newProblems(now, old).length, 1); // one is the old problem moved, one is new
});

test("defence signature id must be its target's ttp, even across authors", () => {
  const root = copy();
  replace(root, DS, "target: agent_02.fileScopeEscape.001.sb", "target: agent_01.indprominjec01Ka.001.ka");
  const p = check(root).items.find((x) => x.code === "DEF-S13");
  assert.ok(p);
  assert.match(p.fix, /agent_01/);
});
