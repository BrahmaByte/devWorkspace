import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GitBranchService,
  type GitRunner,
} from "../../src/application/services/gitBranchService";

class FakeGitRunner implements GitRunner {
  public constructor(private readonly result: string | Error) {}
  public branch(cwd: string): Promise<string | undefined> {
    assert.equal(cwd, "/work/project");
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}

void describe("Git branch service", () => {
  void it("returns a trimmed branch without exposing Git failures", async () => {
    assert.equal(
      await new GitBranchService(new FakeGitRunner(" feature/ui\n")).getBranch(
        "/work/project",
      ),
      "feature/ui",
    );
    assert.equal(
      await new GitBranchService(
        new FakeGitRunner(new Error("not a repository")),
      ).getBranch("/work/project"),
      undefined,
    );
  });

  void it("rejects unexpectedly large output", async () => {
    assert.equal(
      await new GitBranchService(new FakeGitRunner("x".repeat(256))).getBranch(
        "/work/project",
      ),
      undefined,
    );
  });
});
