import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  StartWorkService,
  validateBranchName,
  type BranchConfirmationGateway,
  type GitWorkflow,
  type ProjectWorkspaceGateway,
} from "../../src/application/services/startWorkService";
import { WorkspaceService } from "../../src/application/services/workspaceService";
import { getDatabasePath } from "../../src/infrastructure/database/location";
import { LocalDatabase } from "../../src/infrastructure/database/localDatabase";
import { WorkspaceRepository } from "../../src/infrastructure/database/workspaceRepository";

const directories: string[] = [];
class FakeGit implements GitWorkflow {
  public repository = true;
  public exists = false;
  public switches: Array<{ branch: string; create: boolean }> = [];
  public isRepository() {
    return Promise.resolve(this.repository);
  }
  public branchExists() {
    return Promise.resolve(this.exists);
  }
  public switchBranch(_cwd: string, branch: string, create: boolean) {
    this.switches.push({ branch, create });
    return Promise.resolve();
  }
}
class FakeWorkspace implements ProjectWorkspaceGateway {
  public calls: string[] = [];
  public openProject(path: string) {
    this.calls.push(`project:${path}`);
    return Promise.resolve();
  }
  public openTerminal(path: string) {
    this.calls.push(`terminal:${path}`);
    return Promise.resolve();
  }
}
class FakeConfirmation implements BranchConfirmationGateway {
  public constructor(
    public answer = true,
    public calls = 0,
  ) {}
  public confirmBranchChange() {
    this.calls += 1;
    return Promise.resolve(this.answer);
  }
}

void afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function setup(associate = true) {
  const directory = await mkdtemp(join(tmpdir(), "devworkspace-start-work-"));
  directories.push(directory);
  const database = await LocalDatabase.open(getDatabasePath(directory));
  const repository = new WorkspaceRepository(database);
  const workspaceService = new WorkspaceService(repository, "linux");
  const projectId = await workspaceService.createProject("API", "/work/api");
  if (associate) await workspaceService.associateJiraProject(projectId, "DEV");
  const git = new FakeGit();
  const gateway = new FakeWorkspace();
  const confirmation = new FakeConfirmation();
  return {
    database,
    repository,
    git,
    gateway,
    confirmation,
    service: new StartWorkService(repository, git, gateway, confirmation),
  };
}

void describe("Start Work", () => {
  void it("rejects an issue with no associated project", async () => {
    const context = await setup(false);
    await assert.rejects(context.service.start("DEV-7"), /associated/u);
    assert.deepEqual(context.gateway.calls, []);
    context.database.close();
  });

  void it("rejects an associated folder that is not a Git repository", async () => {
    const context = await setup();
    context.git.repository = false;
    await assert.rejects(context.service.start("DEV-7"), /Git repository/u);
    assert.deepEqual(context.gateway.calls, []);
    context.database.close();
  });

  void it("validates branches and requires confirmation before changing Git state", async () => {
    const context = await setup();
    for (const unsafe of ["../escape", "feature//bad", "bad branch", "x;rm-rf"])
      assert.throws(() => validateBranchName(unsafe));
    context.confirmation.answer = false;
    const cancelled = await context.service.start("DEV-7", "feature/DEV-7");
    assert.equal(cancelled.started, false);
    assert.deepEqual(context.git.switches, []);
    assert.deepEqual(context.gateway.calls, []);

    context.confirmation.answer = true;
    const result = await context.service.start("DEV-7", "feature/DEV-7");
    assert.deepEqual(context.git.switches, [
      { branch: "feature/DEV-7", create: true },
    ]);
    assert.deepEqual(context.gateway.calls, [
      "terminal:/work/api",
      "project:/work/api",
    ]);
    assert.equal(result.branchChanged, true);
    assert.equal(result.started, true);
    context.database.close();
  });
});
