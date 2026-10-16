// One planted mistake per check: each must produce its own code. A new check gets a row here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copy, check, read, write, append, remove, rename, replace } from "./helpers.js";

const AS = "attack/agent/sb_sig.yaml";
const KS = "attack/agent/ka_sig.yaml";
const AT = "attack/agent/_ttp.yaml";
const DS = "defence/agent/sb_sig.yaml";
const DT = "defence/agent/_ttp.yaml";
const RS = "remediation/agent/sb_sig.yaml";
const IND = "_compliance_industries_agents/industries_agent.yaml";
const CMP = "_compliance_industries_agents/compliance/_agent_mapping.yaml";
const CMPL = "_compliance_industries_agents/compliance/file.list";
const REG = (r, id) => replace(r, CMP, "compliance:\n", `compliance:\n  - id: ${id}\n    map:\n      x:\n        - y\n`);

test("the fixture itself is clean", () => {
  const { items } = check(copy());
  assert.deepEqual(items, []);
});

const CASES = [
  // every folder / every YAML file
  ["RB-G01", "folder without file.list", (r) => remove(r, "attack/agent/file.list")],
  ["RB-G02", "listed file is missing", (r) => append(r, "attack/agent/file.list", "zz_sig.yaml\n")],
  ["RB-G03", "file not in file.list", (r) => write(r, "attack/agent/zz_sig.yaml", "signatures: []\n")],
  ["RB-G04", "name listed twice", (r) => append(r, "attack/agent/file.list", "sb_sig.yaml\n")],
  ["RB-G04", "path in file.list", (r) => append(r, "attack/agent/file.list", "../x_sig.yaml\n")],
  ["RB-G05", "capital letters in a file name", (r) => { rename(r, KS, "attack/agent/Ka_sig.yaml"); replace(r, "attack/agent/file.list", "ka_sig", "Ka_sig"); }],
  ["RB-G05", "leading _ in a signature file name", (r) => { rename(r, KS, "attack/agent/_ka_sig.yaml"); replace(r, "attack/agent/file.list", "ka_sig", "_ka_sig"); }],
  ["RB-G05", "badly named compliance file", (r) => { write(r, "_compliance_industries_agents/compliance/agent.yaml", "compliance: []\n"); append(r, CMPL, "agent.yaml\n"); }],
  ["RB-G06", "repeated key", (r) => replace(r, AS, "    severity: critical\n", "    severity: critical\n    severity: high\n")],
  ["RB-G06", "tab indentation", (r) => replace(r, AS, "    severity: critical\n", "\tseverity: critical\n")],
  ["RB-G07", "extra spaces", (r) => replace(r, IND, "description: Applies", "description:   Applies")],
  ["RB-G08", "unknown field", (r) => replace(r, AS, "    tier: basic\n", "    tier: basic\n    industry: x\n")],
  ["RB-G09", "wrong root key", (r) => replace(r, DT, "ttps:", "ttp:")],
  ["RB-G10", "defence category without attack", (r) => { write(r, "defence/zzz/file.list", "_ttp.yaml\n"); write(r, "defence/zzz/_ttp.yaml", "ttps: []\n"); }],
  ["RB-G11", "file.list without _ttp.yaml", (r) => replace(r, "attack/agent/file.list", "_ttp.yaml\n", "")],
  ["RB-G12", "no space after colon", (r) => replace(r, IND, "  - name: Banking", "  - name:Banking")],
  ["RB-G13", "undeclared category", (r) => { write(r, "attack/zzz/file.list", "_ttp.yaml\n"); write(r, "attack/zzz/_ttp.yaml", "ttps: []\n"); }],
  ["RB-G14", "file directly in attack/", (r) => write(r, "attack/readme.yaml", "x: 1\n")],
  ["RB-G14", "sub-folder in a category", (r) => write(r, "attack/agent/old/x.yaml", "x: 1\n")],
  // registry
  ["IND-01", "extra file in the registry folder", (r) => write(r, "_compliance_industries_agents/extra.yaml", "x: 1\n")],
  ["IND-02", "industries root key", (r) => replace(r, IND, "agents:", "industries:")],
  ["IND-03", "industry without a name", (r) => replace(r, IND, "  - name: Generic\n    description:", "  - description:")],
  ["IND-04", "duplicate sibling name", (r) => replace(r, IND, "  - name: Healthcare", "  - name: Banking")],
  ["IND-05", "dot in an industry name", (r) => replace(r, IND, "  - name: Generic", "  - name: Gen.eric")],
  ["IND-06", "sub is not a list", (r) => replace(r, IND, "  - name: Generic\n", "  - name: Generic\n    sub: x\n")],
  ["CMP-01", "compliance id empty", (r) => replace(r, CMP, "  - id: agent_01\n", "  - id: ''\n")],
  ["CMP-02", "id registered twice across files", (r) => replace(r, "_compliance_industries_agents/compliance/_owasp_top_10_mapping.yaml", "compliance:\n", "compliance:\n  - id: agent_01\n    map:\n      x:\n        - y\n")],
  ["CMP-03", "map missing", (r) => replace(r, CMP, "  - id: agent_01\n    map:", "  - id: agent_01\n    mapx:")],
  ["CMP-04", "framework with no controls", (r) => replace(r, CMP, "      owasp_agentic_top_10:\n        - ASI01\n", "      owasp_agentic_top_10: []\n")],
  ["CMP-06", "id of another category", (r) => replace(r, CMP, "  - id: agent_01\n", "  - id: agent_1\n")],
  ["CMP-07", "category declared with no attack folder", (r) => { write(r, "_compliance_industries_agents/compliance/_evasion_mapping.yaml", "compliance:\n  - id: evasion_01\n    map:\n      x:\n        - y\n"); append(r, CMPL, "_evasion_mapping.yaml\n"); }],
  ["CMP-08", "registered id no attack ttp declares", (r) => REG(r, "agent_09")],
  // _ttp.yaml
  ["ATK-T01", "ttp id empty", (r) => replace(r, AT, "  - id: agent_02\n", "  - id: ''\n")],
  ["ATK-T02", "ttp id declared twice", (r) => replace(r, AT, "  - id: agent_02\n", "  - id: agent_01\n")],
  ["ATK-T03", "ttp name empty", (r) => replace(r, AT, "    name: asi01_agent_goal_hijack\n", "    name: ''\n")],
  ["ATK-T04", "ttp name reused (case-insensitive)", (r) => replace(r, AT, "    name: asi02_tool_misuse_exploitation", "    name: ASI01_agent_goal_hijack")],
  ["ATK-T05", "ttp id of another category", (r) => replace(r, AT, "  - id: agent_01\n", "  - id: owasp_top_10_01\n")],
  ["ATK-T07", "ttp without compliance", (r) => replace(r, AT, "\n    compliance: agent_01", "")],
  ["ATK-T08", "compliance not registered", (r) => replace(r, AT, "    compliance: agent_01", "    compliance: agent_98")],
  ["ATK-T09", "ttp id not registered", (r) => replace(r, AT, "  - id: agent_01\n", "  - id: agent_97\n")],
  ["DEF-T06", "defence ttp attack doesn't declare", (r) => { REG(r, "agent_09"); append(r, DT, "  - id: agent_09\n    name: x\n"); }],
  ["DEF-T07", "attack ttp missing from defence _ttp", (r) => replace(r, DT, "  - id: agent_02\n    name: asi02_tool_misuse_exploitation\n", "")],
  ["REM-T07", "attack ttp missing from remediation _ttp", (r) => replace(r, "remediation/agent/_ttp.yaml", "  - id: agent_02\n    name: asi02_tool_misuse_exploitation\n", "")],
  // attack signatures
  ["ATK-S01", "signature file root key", (r) => replace(r, AS, "signatures:", "prompts:")],
  ["ATK-S02", "signature id empty", (r) => replace(r, AS, "  - id: agent_01\n", "  - id: ''\n")],
  ["ATK-S03", "signature name missing", (r) => replace(r, AS, "    name: agent_01.priorityTaskSubstitution.001.sb\n", "")],
  ["ATK-S03", "name starting with # (a YAML comment)", (r) => replace(r, AS, "    name: agent_01.priorityTaskSubstitution.001.sb", "    name: #agent_01.x")],
  ["ATK-S04", "severity missing", (r) => replace(r, AS, "    severity: critical\n", "")],
  ["ATK-S05", "prompt missing", (r) => replace(r, AS, "    prompt: 'SYSTEM", "    promptx: 'SYSTEM")],
  ["ATK-S06", "attack missing", (r) => { const t = read(r, AS); write(r, AS, t.replace(/\n    attack: [^\n]*/, "")); }],
  ["ATK-S08", "signature id of another category", (r) => replace(r, AS, "  - id: agent_01\n", "  - id: owasp_top_10_01\n")],
  ["ATK-S09", "signature id not registered", (r) => replace(r, AS, "  - id: agent_01\n", "  - id: agent_96\n")],
  ["ATK-S10", "signature id not in _ttp.yaml", (r) => { REG(r, "agent_09"); replace(r, AS, "  - id: agent_01\n", "  - id: agent_09\n"); }],
  ["ATK-S11", "signature name used in another file", (r) => replace(r, KS, "name: agent_01.indprominjec01Ka.001.ka", "name: agent_01.directGoalOverride.001.sb")],
  ["ATK-S12", "severity not allowed", (r) => replace(r, AS, "    severity: critical\n", "    severity: severe\n")],
  ["ATK-S13", "agent key missing", (r) => replace(r, AS, "    agent: []\n", "")],
  ["ATK-S14", "unknown agent", (r) => replace(r, AS, "    agent: []\n", "    agent: [Retail]\n")],
  // defence
  ["DEF-S03", "defence target missing", (r) => replace(r, DS, "    target: agent_01.directGoalOverride.001.sb\n", "")],
  ["DEF-S04", "refusal_regex missing", (r) => replace(r, DS, "    refusal_regex:", "    refusal_rx:")],
  ["DEF-S11", "target is not an attack name", (r) => replace(r, DS, "target: agent_01.directGoalOverride.001.sb", "target: agent_01.directGoalOverride.01.sb")],
  ["DEF-S12", "regex does not compile", (r) => { const t = read(r, DS); write(r, DS, t.replace(/refusal_regex: [^\n]*/, "refusal_regex: '*(?i)refuse'")); }],
  ["DEF-S13", "defence id differs from its target's ttp", (r) => replace(r, DS, "  - id: agent_01\n", "  - id: agent_02\n")],
  ["DEF-S14", "detection name reused", (r) => replace(r, DS, "name: agent_02.baselineRefusal.001.sb", "name: agent_01.baselineRefusal.001.sb")],
  // remediation
  ["REM-S11", "remediation target is not an attack name", (r) => replace(r, RS, "target: agent_01.directGoalOverride.001.sb", "target: agent_01.nope")],
  ["REM-S12", "same target twice in one file", (r) => replace(r, RS, "target: agent_02.fileScopeEscape.001.sb", "target: agent_01.directGoalOverride.001.sb")],
  ["REM-S13", "same title twice in one file", (r) => replace(r, RS, "title: asi02_tool_misuse_exploitation remediation", "title: asi01_agent_goal_hijack remediation")],
  ["REM-S14", "mitigation_steps is not a list", (r) => { const t = read(r, RS); write(r, RS, t.replace(/    mitigation_steps:\n(      - [^\n]*\n)+/, "    mitigation_steps: do the thing\n")); }],
  ["REM-S15", "remediation id differs from its target's ttp", (r) => replace(r, RS, "  - id: agent_01\n", "  - id: agent_02\n")],
];

for (const [code, label, plant] of CASES) {
  test(`${code}: ${label}`, () => {
    const root = copy();
    plant(root);
    const { codes, items } = check(root);
    assert.ok(codes.includes(code), `expected ${code}, got ${codes.join(", ") || "nothing"}\n` + items.map((p) => `${p.file}:${p.line} ${p.code} ${p.msg}`).join("\n"));
  });
}

test("valid agent values pass: names and Parent.Sub", () => {
  const root = copy();
  replace(root, AS, "    agent: []\n", "    agent: [Banking.Loan, Generic]\n");
  assert.deepEqual(check(root).codes, []);
});

test("warnings and info never fail the run", () => {
  const root = copy();
  REG(root, "agent_09");
  const { codes, errors } = check(root);
  assert.deepEqual(codes, ["CMP-08"]);
  assert.equal(errors.length, 0);
});
