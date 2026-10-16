// Every name and rule the linter enforces lives here, so a schema change is a one-file edit.

export const REG_DIR = "_compliance_industries_agents";
export const COMPLIANCE_DIR = REG_DIR + "/compliance";
export const INDUSTRIES_FILE = "industries_agent.yaml";
export const TREES = ["attack", "defence", "remediation"];
export const FILE_LIST = "file.list";
export const TTP_FILE = "_ttp.yaml";

// suman_dutta_sig.yaml, suman_dutta_01_sig.yaml - lowercase, digits, single underscores, no leading "_"
export const SIG_RE = /^([a-z0-9]+(?:_[a-z0-9]+)*)_sig\.yaml$/;
// _agent_mapping.yaml declares "agent"; _owasp_top_10_mapping.yaml declares "owasp_top_10"
// (category names may contain underscores, so ids like owasp_top_10_01 need prefix matching, not split("_")).
export const MAP_RE = /^_([a-z0-9]+(?:_[a-z0-9]+)*)_mapping\.yaml$/;

// A ttp id is <category>_<two or more digits>: agent_01, owasp_top_10_10.
export const idRe = (cat) => new RegExp("^" + cat + "_\\d{2,}$");

export const SEVERITIES = ["low", "medium", "high", "critical"];

// Output of the formatter is the standard every file must already match (RB-G07).
export const FORMAT = { indent: 2, indentSeq: true, lineWidth: 0, flowCollectionPadding: false };

export const TTP = {
  attack: {
    allowed: ["id", "name", "description", "references", "applicable_to", "compliance"],
    required: ["id", "name", "compliance"],
    prefix: "ATK-T",
  },
  defence: { allowed: ["id", "name", "description", "references"], required: ["id", "name"], prefix: "DEF-T" },
  remediation: { allowed: ["id", "name", "description", "references"], required: ["id", "name"], prefix: "REM-T" },
};

// Root key of each compliance mapping file (new-rules uses "compliance:").
export const COMPLIANCE_ROOT = "compliance";

// The order of `required` fixes the codes: first required field is S02, then S03, ...
// Root keys and field names follow the new-rules layout.
export const SIG = {
  attack: {
    root: "signatures",
    prefix: "ATK-S",
    allowed: ["id", "name", "severity", "agent", "prompt", "attack", "tier"],
    required: ["id", "name", "severity", "prompt", "attack"],
  },
  defence: {
    root: "signatures",
    prefix: "DEF-S",
    allowed: ["id", "name", "target", "refusal_regex"],
    required: ["id", "target", "refusal_regex"],
  },
  remediation: {
    root: "remediations",
    prefix: "REM-S",
    // mitigation_steps is a list of steps; description is optional extra prose.
    allowed: ["id", "name", "target", "title", "mitigation_steps", "description", "signature_id"],
    required: ["id", "target", "title", "mitigation_steps"],
  },
};

// Fields whose value must be a non-empty list, not a string (checked after `required`).
export const LIST_FIELDS = { "REM-S": ["mitigation_steps"] };
