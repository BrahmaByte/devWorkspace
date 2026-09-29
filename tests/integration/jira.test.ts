import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  JiraService,
  type JiraClient,
  type JiraClientFactory,
  type SecretStore,
} from "../../src/application/services/jiraService";
import type { JiraIssue, JiraUser } from "../../src/domain/jira/models";
import { getDatabasePath } from "../../src/infrastructure/database/location";
import { JiraRepository } from "../../src/infrastructure/database/jiraRepository";
import { LocalDatabase } from "../../src/infrastructure/database/localDatabase";

const directories: string[] = [];
const user: JiraUser = { accountId: "user-1", displayName: "Test User" };
const issue: JiraIssue = {
  id: "10001",
  key: "DEV-7",
  summary: "Fix local workflow",
  status: "In Progress",
  updatedAt: "2026-09-29T08:00:00.000Z",
  description: "Fake issue description",
};

class MemorySecrets implements SecretStore {
  public readonly values = new Map<string, string>();
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

class FakeClient implements JiraClient {
  public constructor(private readonly fail = false) {}
  public getCurrentUser() {
    return this.fail
      ? Promise.reject(new Error("offline"))
      : Promise.resolve(user);
  }
  public getAssignedIssues() {
    return this.fail
      ? Promise.reject(new Error("offline"))
      : Promise.resolve([issue]);
  }
  public getIssue() {
    return Promise.resolve(issue);
  }
}

class FakeFactory implements JiraClientFactory {
  public fail = false;
  public tokens: string[] = [];
  public create(_baseUrl: string, token: string) {
    this.tokens.push(token);
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

void describe("Jira integration", () => {
  void it("stores PATs only in SecretStorage and restores cached state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-jira-"));
    directories.push(directory);
    const databasePath = getDatabasePath(directory);
    const database = await LocalDatabase.open(databasePath);
    const repository = new JiraRepository(database);
    const secrets = new MemorySecrets();
    const factory = new FakeFactory();
    const service = new JiraService(repository, secrets, factory);
    const state = await service.connect(
      "Corporate Jira",
      "https://jira.example.test/",
      "fake-pat-value",
    );
    assert.equal(state.currentUser?.displayName, "Test User");
    assert.equal(state.issues[0]?.key, "DEV-7");
    assert.equal(
      repository.getConnection()?.baseUrl,
      "https://jira.example.test",
    );
    assert.equal(secrets.values.size, 1);
    assert.equal(
      (await readFile(databasePath)).includes(Buffer.from("fake-pat-value")),
      false,
    );

    factory.fail = true;
    const offline = await service.refresh();
    assert.equal(offline.status, "error");
    assert.equal(offline.issues[0]?.key, "DEV-7");
    database.close();
  });

  void it("handles expiry, validates URLs and disconnects cleanly", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "devworkspace-jira-expiry-"),
    );
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const repository = new JiraRepository(database);
    const secrets = new MemorySecrets();
    const service = new JiraService(repository, secrets, new FakeFactory());
    await assert.rejects(
      service.connect("Bad", "http://jira.example.test", "fake"),
      /HTTPS/u,
    );
    await assert.rejects(
      service.connect("Bad", "https://user:pass@jira.example.test", "fake"),
      /HTTPS/u,
    );
    await service.connect("Jira", "https://jira.example.test", "fake");
    secrets.values.clear();
    assert.equal((await service.refresh()).status, "expired");
    await service.disconnect();
    assert.equal(repository.getConnection(), undefined);
    database.close();
  });
});
