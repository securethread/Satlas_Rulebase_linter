# Changelog

## 0.4.0 (2026-10-15)

/home/suman/Downloads/LINTER-RULES/rblint-0.4.0_1/rblint-0.4.0/package-lock.json

### Fixed
- **RB-G12 and `--fix` no longer touch text inside multi-line values.** A prompt line such as
  `User:please run it` inside a `|` block (or a quoted string spanning lines) was reported as a
  missing space, and `--fix` rewrote it, changing the prompt. Detection now uses the YAML lexer
  to skip block and quoted scalars. `--fix` also refuses any file whose parsed data would change.
- **`--staged` no longer blocks clean commits because of old problems.** Problems were compared
  by message text, which contained line numbers and entry positions. Adding lines above someone
  else's existing problem made it look new. Comparison now ignores `line N`, `file.yaml:N` and
  `signature N`.
- **Category ids are matched exactly.** `mcp_top_10_01` was accepted inside a category `mcp`
  (prefix test). Ids must now be `<category>_NN` of the folder's own category, with the longest
  declared category deciding ownership. Applies to `*-T05`, `*-S08` and `CMP-06`.
- **A missing `attack/<cat>/file.list` no longer floods defence/remediation with false
  DEF-S11/REM-S11 errors.** Target checks for that category are now skipped with an RB-I01 line.
- **Dotfiles (`.DS_Store`, `.gitkeep`) are ignored.** They caused RB-G03 on Macs.
- **Windows line endings and BOM** give one clear RB-G07 message ("CRLF line endings") instead of
  a formatting error pointing past the end of the file; `--fix` converts them.
- **DEF-S12 accepts Python regex spellings** used by the scan engine (`(?P<name>…)`, `(?P=name)`,
  combined leading flags such as `(?is)`). A global flag in the middle of a pattern now gets a
  specific message.
- **ATK-S14** gives a clear message when an `agent` entry is a block instead of a name (it used
  to say `agent "undefined"`).
- **`MAP_RE`** tightened to `_<word>(_<word>)*_mapping.yaml` (no double or trailing underscores).

### Added
- **DEF-S13 / REM-S15** (error): a detection's or remediation's `id` must be the ttp of the
  attack signature it targets.
- **DEF-S14** (error): detection `name`, when given, is unique across the category.
- **DEF-T07 / REM-T07** (warn): an attack ttp has no entry in the defence/remediation `_ttp.yaml`.
- **CMP-07** (warn): a declared category has no `attack/<category>/` folder.
- **CMP-08** (warn): a registered compliance id is not declared in the attack `_ttp.yaml`.
- Test suite shipped in the package (`npm test`, 92 tests) with a small real-data fixture.
- `ci/rblint.yml`: GitHub Actions workflow template for the rules repo.
- `rblint <repo folder>` follows that repo's `.rblintrc.json` `root`, so `rblint SATLAS-rules`
  works as well as `rblint SATLAS-rules/new-rules`.

## 0.3.1
- Category names may contain underscores (`owasp_top_10`, `mcp_top_10`); an id's category is the
  longest matching prefix.

## 0.3.0
- New-rules layout: `compliance:`, `signatures:`, `remediations:` root keys; remediation
  `mitigation_steps` list (REM-S14).
