import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  ConfluenceService,
  type ConfluenceClient,
  type ConfluenceClientFactory,
} from "../../src/application/services/confluenceService";
import type { SecretStore } from "../../src/application/services/jiraService";
import type { ConfluencePage } from "../../src/domain/confluence/models";
import type { AtlassianCredential } from "../../src/application/services/atlassianAuth";
import { ConfluenceRepository } from "../../src/infrastructure/database/confluenceRepository";
import { getDatabasePath } from "../../src/infrastructure/database/location";
import { LocalDatabase } from "../../src/infrastructure/database/localDatabase";

const directories: string[] = [];
const page: ConfluencePage = {
  id: "42",
  title: "Runbook",
  spaceName: "Engineering",
  webUrl: "/display/ENG/Runbook",
  updatedAt: "2026-09-29T00:00:00Z",
};
class MemorySecrets implements SecretStore {
  public values = new Map<string, string>();
  public get(key: string) {
    return Promise.resolve(this.values.get(key));
  }
  public store(key: string, value: string) {
    this.values.set(key, value);
    return Promise.resolve();
  }
  public delete(key: string) {
    this.values.delete(key);
    return Promise.resolve();
  }
}
class FakeClient implements ConfluenceClient {
  public constructor(private readonly fail = false) {}
  public testConnection() {
    return this.fail
      ? Promise.reject(Object.assign(new Error("offline"), { status: 503 }))
      : Promise.resolve();
  }
  public searchPages() {
    return this.fail
      ? Promise.reject(new Error("offline"))
      : Promise.resolve([page]);
  }
}
class FakeFactory implements ConfluenceClientFactory {
  public fail = false;
  public credentials: AtlassianCredential[] = [];
  public create(_url: string, credential: AtlassianCredential) {
    this.credentials.push(credential);
    return new FakeClient(this.fail);
  }
}
void afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

void describe("Confluence integration", () => {
  void it("stores PAT only in SecretStorage and caches bounded page metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-confluence-"));
    directories.push(directory);
    const databasePath = getDatabasePath(directory);
    const database = await LocalDatabase.open(databasePath);
    const repository = new ConfluenceRepository(database);
    const secrets = new MemorySecrets();
    const factory = new FakeFactory();
    const service = new ConfluenceService(repository, secrets, factory);
    await service.connect(
      "Docs",
      "https://confluence.example.test/",
      "fake-confluence-pat",
    );
    const state = await service.search("runbook");
    assert.equal(state.pages[0]?.title, "Runbook");
    assert.equal(
      service.getPageUrl("42"),
      "https://confluence.example.test/display/ENG/Runbook",
    );
    assert.equal(
      (await readFile(databasePath)).includes(
        Buffer.from("fake-confluence-pat"),
      ),
      false,
    );
    factory.fail = true;
    const offline = await service.refresh();
    assert.equal(offline.status, "error");
    assert.equal(offline.pages[0]?.title, "Runbook");
    database.close();
  });

  void it("rejects unsafe URLs and removes metadata and secrets on disconnect", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "devworkspace-confluence-expiry-"),
    );
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const repository = new ConfluenceRepository(database);
    const secrets = new MemorySecrets();
    const service = new ConfluenceService(
      repository,
      secrets,
      new FakeFactory(),
    );
    await assert.rejects(
      service.connect("Bad", "http://confluence.example.test", "fake"),
      /HTTPS/u,
    );
    await service.connect("Docs", "https://confluence.example.test", "fake");
    await service.search("runbook");
    await service.disconnect();
    assert.equal(repository.getConnection(), undefined);
    assert.equal(secrets.values.size, 0);
    database.close();
  });

  void it("normalizes Confluence Cloud and keeps Cloud credentials secret", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "devworkspace-confluence-cloud-"),
    );
    directories.push(directory);
    const databasePath = getDatabasePath(directory);
    const database = await LocalDatabase.open(databasePath);
    const repository = new ConfluenceRepository(database);
    const factory = new FakeFactory();
    await new ConfluenceService(
      repository,
      new MemorySecrets(),
      factory,
    ).connect(
      "Confluence Cloud",
      "https://team.atlassian.net",
      "fake-cloud-token",
      "user@example.com",
    );
    assert.equal(
      repository.getConnection()?.baseUrl,
      "https://team.atlassian.net/wiki",
    );
    assert.deepEqual(factory.credentials[0], {
      type: "basic",
      email: "user@example.com",
      token: "fake-cloud-token",
    });
    const databaseBytes = await readFile(databasePath);
    assert.equal(
      databaseBytes.includes(Buffer.from("fake-cloud-token")),
      false,
    );
    assert.equal(
      databaseBytes.includes(Buffer.from("user@example.com")),
      false,
    );
    database.close();
  });
});
