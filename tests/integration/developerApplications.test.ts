import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  DeveloperApplicationService,
  type DeveloperApplicationProcessGateway,
  type ManagedApplicationProcess,
} from "../../src/application/services/developerApplicationService";
import { DeveloperApplicationRepository } from "../../src/infrastructure/database/developerApplicationRepository";
import { getDatabasePath } from "../../src/infrastructure/database/location";
import { LocalDatabase } from "../../src/infrastructure/database/localDatabase";

const directories: string[] = [];

class FakeProcess implements ManagedApplicationProcess {
  public readonly exited: Promise<void>;
  public closeCount = 0;
  private completeExit: () => void = () => undefined;

  public constructor() {
    this.exited = new Promise((complete) => {
      this.completeExit = complete;
    });
  }

  public close(): Promise<void> {
    this.closeCount += 1;
    this.completeExit();
    return Promise.resolve();
  }
}

class FakeProcessGateway implements DeveloperApplicationProcessGateway {
  public readonly process = new FakeProcess();
  public inspectedPath?: string;
  public launchedPath?: string;

  public inspect(executablePath: string): Promise<{ readonly name: string }> {
    this.inspectedPath = executablePath;
    return Promise.resolve({ name: "Developer Tool" });
  }

  public launch(executablePath: string): Promise<ManagedApplicationProcess> {
    this.launchedPath = executablePath;
    return Promise.resolve(this.process);
  }
}

void afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

void describe("developer applications", () => {
  void it("persists app metadata but exposes no path or process ID", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-apps-"));
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const gateway = new FakeProcessGateway();
    const service = new DeveloperApplicationService(
      new DeveloperApplicationRepository(database),
      gateway,
    );

    const id = await service.add("/safe/tools/developer-tool");
    const summary = service.list()[0];
    assert.equal(summary?.id, id);
    assert.equal(summary?.name, "Developer Tool");
    assert.equal(summary?.status, "stopped");
    assert.equal("executablePath" in (summary ?? {}), false);
    assert.equal("pid" in (summary ?? {}), false);
    assert.equal(gateway.inspectedPath, "/safe/tools/developer-tool");

    database.close();
    const reopened = await LocalDatabase.open(getDatabasePath(directory));
    assert.equal(
      new DeveloperApplicationRepository(reopened).get(id)?.executablePath,
      "/safe/tools/developer-tool",
    );
    reopened.close();
  });

  void it("tracks and closes only a process launched by the service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-apps-"));
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const gateway = new FakeProcessGateway();
    const service = new DeveloperApplicationService(
      new DeveloperApplicationRepository(database),
      gateway,
    );
    const id = await service.add("/safe/tools/developer-tool");

    await assert.rejects(service.close(id), /not running/u);
    await service.launch(id);
    assert.equal(service.list()[0]?.status, "running");
    assert.equal(gateway.launchedPath, "/safe/tools/developer-tool");
    await assert.rejects(service.delete(id), /Close the application/u);

    await service.close(id);
    await gateway.process.exited;
    await new Promise((complete) => setImmediate(complete));
    assert.equal(gateway.process.closeCount, 1);
    assert.equal(service.list()[0]?.status, "stopped");
    await service.delete(id);
    assert.deepEqual(service.list(), []);
    database.close();
  });
});
