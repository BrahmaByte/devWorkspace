import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const workspacePath = resolve(process.cwd());
const codeExecutable = process.platform === "win32" ? "code.cmd" : "code";
const result = spawnSync(
  codeExecutable,
  [
    "--new-window",
    `--extensionDevelopmentPath=${workspacePath}`,
    workspacePath,
  ],
  { stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
