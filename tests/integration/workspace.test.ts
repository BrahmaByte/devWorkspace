import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  CommandExecutionService,
  type CommandExecutor,
  type ConfirmationGateway,
} from "../../src/application/services/commandExecutionService";
import { WorkspaceService } from "../../src/application/services/workspaceService";
import { getDatabasePath } from "../../src/infrastructure/database/location";
import { LocalDatabase } from "../../src/infrastructure/database/localDatabase";
import { WorkspaceRepository } from "../../src/infrastructure/database/workspaceRepository";

const directories: string[] = [];
class FakeExecutor implements CommandExecutor {
  public calls: Array<{ shell: string; command?: string; cwd?: string }> = [];
  public execute(shell: string, command: string, cwd?: string) {
    this.calls.push({ shell, command, cwd });
    return Promise.resolve();
  }
  public openTerminal(cwd: string, shell: string) {
    this.calls.push({ shell, cwd });
    return Promise.resolve();
  }
}
class FakeConfirmation implements ConfirmationGateway {
  public constructor(
    private readonly answer: boolean,
    public calls = 0,
  ) {}
  public confirm() {
    this.calls += 1;
    return Promise.resolve(this.answer);
  }
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "devworkspace-workspace-"));
  directories.push(directory);
  const database = await LocalDatabase.open(getDatabasePath(directory));
  const repository = new WorkspaceRepository(database);
  return {
    database,
    repository,
    service: new WorkspaceService(repository, "linux"),
  };
}
void afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

void describe("workspace management", () => {
  void it("preserves legacy project metadata and relationships across edits and restart", async () => {
    const { database, service } = await setup();
    const projectId = await service.createProject("API", "/work/api");
    database.run(
      "UPDATE projects SET preferred_ide='idea', is_favourite=1, jira_project_key='DEV' WHERE id=?;",
      [projectId],
    );
    database.run(
      "INSERT INTO relationships(id,source_type,source_id,target_type,target_id,created_at) VALUES('legacy-link','note','legacy-note','project',?,'2026-01-01');",
      [projectId],
    );
    await service.updateProject(projectId, "Renamed API", "/work/api");
    assert.deepEqual(Object.keys(service.getState().projects[0] ?? {}).sort(), [
      "createdAt",
      "id",
      "localPath",
      "name",
      "updatedAt",
    ]);
    database.close();
    const restored = await LocalDatabase.open(
      getDatabasePath(directories[directories.length - 1] as string),
    );
    assert.deepEqual(
      restored.query(
        "SELECT preferred_ide,is_favourite,jira_project_key FROM projects WHERE id=?;",
        [projectId],
      ),
      [{ preferred_ide: "idea", is_favourite: 1, jira_project_key: "DEV" }],
    );
    assert.equal(
      restored.getScalar(
        "SELECT COUNT(*) FROM relationships WHERE id='legacy-link';",
      ),
      1,
    );
    restored.close();
  });
  void it("validates paths for the configured platform independently of the test host", async () => {
    const { database, repository } = await setup();
    for (const operatingSystem of ["linux", "macos"] as const) {
      const service = new WorkspaceService(repository, operatingSystem);
      await service.createProject(operatingSystem, `/work/${operatingSystem}`);
      await assert.rejects(
        service.createProject("Traversal", "/work/../escape"),
      );
      await assert.rejects(service.createProject("Windows", "C:\\work\\api"));
    }
    database.close();
  });
  void it("manages projects, commands, and environment metadata", async () => {
    const { database, service } = await setup();
    const projectId = await service.createProject("API", "/work/api");
    const commandId = await service.createCommand(
      projectId,
      "Test",
      "npm test",
      "any",
      "/bin/sh",
      undefined,
      "dangerous",
    );
    const environmentId = await service.createEnvironment(
      projectId,
      "Local",
      "Names only",
      ["API_URL", "LOG_LEVEL"],
    );
    const state = service.getState();
    assert.equal(state.commands[0]?.id, commandId);
    assert.deepEqual(state.environmentProfiles[0]?.variableNames, [
      "API_URL",
      "LOG_LEVEL",
    ]);
    assert.doesNotMatch(
      JSON.stringify(state.environmentProfiles),
      /password|secret-value/iu,
    );
    await service.deleteEnvironment(environmentId);
    await service.deleteCommand(commandId);
    await service.deleteProject(projectId);
    assert.equal(service.getState().projects.length, 0);
    database.close();
  });

  void it("rejects traversal, multiline commands, invalid variables, and unsafe no-confirm commands", async () => {
    const { database, service } = await setup();
    const projectId = await service.createProject("API", "/work/api");
    await assert.rejects(service.createProject("Bad", "../relative"));
    await assert.rejects(service.createProject("Bad", "/work/../escape"));
    await assert.rejects(
      service.createCommand(
        projectId,
        "Bad",
        "echo ok\nrm -rf /",
        "any",
        "/bin/sh",
        undefined,
        "always",
      ),
    );
    await assert.rejects(
      service.createCommand(
        projectId,
        "Bad",
        "rm -rf /",
        "any",
        "/bin/sh",
        undefined,
        "never",
      ),
    );
    await assert.rejects(
      service.createCommand(
        undefined,
        "Bad path",
        "npm test",
        "any",
        "/bin/sh",
        "../escape",
        "always",
      ),
    );
    await assert.rejects(
      service.createEnvironment(projectId, "Bad", "", ["TOKEN=value"]),
    );
    database.close();
  });

  void it("executes stored commands with optional trusted paths and confirmation", async () => {
    const { database, repository, service } = await setup();
    const projectId = await service.createProject("API", "/work/api");
    const safeId = await service.createCommand(
      projectId,
      "Test",
      "npm test",
      "linux",
      "/bin/sh",
      "/work/api/scripts",
      "always",
    );
    const executor = new FakeExecutor();
    const confirmation = new FakeConfirmation(true);
    const execution = new CommandExecutionService(
      repository,
      executor,
      confirmation,
      "linux",
    );
    await execution.execute(safeId);
    assert.deepEqual(executor.calls[0], {
      shell: "/bin/sh",
      command: "npm test",
      cwd: "/work/api/scripts",
    });
    assert.equal(confirmation.calls, 1);
    const deniedId = await service.createCommand(
      projectId,
      "Denied",
      "npm run build",
      "any",
      "/bin/sh",
      undefined,
      "always",
    );
    const deniedExecutor = new FakeExecutor();
    await new CommandExecutionService(
      repository,
      deniedExecutor,
      new FakeConfirmation(false),
      "linux",
    ).execute(deniedId);
    assert.equal(deniedExecutor.calls.length, 0);
    await assert.rejects(
      new CommandExecutionService(
        repository,
        executor,
        confirmation,
        "windows",
      ).execute(safeId),
      /platform/u,
    );
    database.close();
  });

  void it("runs a project-independent command in the default terminal directory", async () => {
    const { database, repository, service } = await setup();
    const exactCommand = 'node  -e  "console.log(1)"';
    const commandId = await service.createCommand(
      undefined,
      "Status",
      exactCommand,
      "any",
      "/bin/sh",
      undefined,
      "never",
    );
    const executor = new FakeExecutor();
    await new CommandExecutionService(
      repository,
      executor,
      new FakeConfirmation(true),
      "linux",
    ).execute(commandId);
    assert.deepEqual(executor.calls[0], {
      shell: "/bin/sh",
      command: exactCommand,
      cwd: undefined,
    });
    database.close();
  });

  void it("maps Windows project paths when resolving command directories", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-windows-"));
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const repository = new WorkspaceRepository(database);
    const service = new WorkspaceService(repository, "windows");
    const projectId = await service.createProject("API", "C:\\work\\api");
    const commandId = await service.createCommand(
      projectId,
      "Test",
      "npm test",
      "windows",
      "cmd.exe",
      "C:\\work\\api\\scripts",
      "never",
    );
    const executor = new FakeExecutor();
    await new CommandExecutionService(
      repository,
      executor,
      new FakeConfirmation(true),
      "windows",
    ).execute(commandId);
    assert.equal(executor.calls[0]?.cwd, "C:\\work\\api\\scripts");
    database.close();
  });
});
