import { execFile } from "node:child_process";

import type { GitRunner } from "../../application/services/gitBranchService";

export class NodeGitRunner implements GitRunner {
  public branch(cwd: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      execFile(
        "git",
        ["branch", "--show-current"],
        { cwd, encoding: "utf8", maxBuffer: 4_096, timeout: 3_000 },
        (error, stdout) => resolve(error ? undefined : stdout),
      );
    });
  }
}
