// rblint install-hook / uninstall-hook: wire the globally installed rblint into a repo's pre-commit.
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const MARK = "# installed by rblint";

export const HOOK = `#!/bin/sh
${MARK} - remove with: rblint uninstall-hook
# Checks exactly what is staged and reports only problems this commit adds.
if command -v rblint >/dev/null 2>&1; then
  rblint --staged
else
  echo "rblint is not installed on this machine - install it, then commit again:"
  echo "  npm install -g rblint-<version>.tgz   (see the rblint README)"
  exit 1
fi
status=$?
if [ $status -eq 1 ]; then
  echo ""
  echo "Commit blocked by rblint. Fix the problems above (rblint --fix handles spacing), git add, and commit again."
fi
exit $status
`;

function hooksDir(cwd) {
  const git = (args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  let top;
  try { top = git(["rev-parse", "--show-toplevel"]); } catch { throw new Error("not inside a git repository"); }
  let custom = "";
  try { custom = git(["config", "--get", "core.hooksPath"]); } catch {}
  if (custom) return path.resolve(top, custom);
  return path.resolve(top, git(["rev-parse", "--git-path", "hooks"]));
}

export function installHook(cwd, { force = false } = {}) {
  const dir = hooksDir(cwd);
  const file = path.join(dir, "pre-commit");
  if (fs.existsSync(file)) {
    const cur = fs.readFileSync(file, "utf8");
    if (!cur.includes(MARK) && !force) {
      throw new Error(`${file} already exists and was not written by rblint. Add "rblint --staged" to it yourself, or run rblint install-hook --force to replace it`);
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, HOOK, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return file;
}

export function uninstallHook(cwd) {
  const file = path.join(hooksDir(cwd), "pre-commit");
  if (!fs.existsSync(file)) return null;
  if (!fs.readFileSync(file, "utf8").includes(MARK)) throw new Error(`${file} was not written by rblint - leaving it alone`);
  fs.unlinkSync(file);
  return file;
}
