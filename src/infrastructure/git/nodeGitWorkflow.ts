import { execFile } from "node:child_process";

import type { GitWorkflow } from "../../application/services/startWorkService";

export class NodeGitWorkflow implements GitWorkflow {
  public async isRepository(cwd: string): Promise<boolean> {
    try {
      return (
        (await runGit(cwd, ["rev-parse", "--is-inside-work-tree"])).trim() ===
        "true"
      );
    } catch {
      return false;
    }
  }

  public async branchExists(cwd: string, branchName: string): Promise<boolean> {
    try {
      await runGit(cwd, [
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${branchName}`,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  public async switchBranch(
    cwd: string,
    branchName: string,
    create: boolean,
  ): Promise<void> {
    await runGit(
      cwd,
      create ? ["switch", "-c", branchName] : ["switch", branchName],
    );
  }
}

function runGit(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      { cwd, encoding: "utf8", maxBuffer: 16_384, timeout: 10_000 },
      (error, stdout) =>
        error
          ? reject(new Error("Git operation failed.", { cause: error }))
          : resolve(stdout),
    );
  });
}
