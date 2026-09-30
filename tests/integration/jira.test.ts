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
import type { AtlassianCredential } from "../../src/application/services/atlassianAuth";
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
  public constructor(
    private readonly fail = false,
    private readonly issueFailure?: Error,
  ) {}
  public getCurrentUser() {
    return this.fail
      ? Promise.reject(new Error("offline"))
      : Promise.resolve(user);
  }
  public getAssignedIssues() {
    if (this.issueFailure) return Promise.reject(this.issueFailure);
    return this.fail
      ? Promise.reject(new Error("offline"))
      : Promise.resolve([issue]);
  }
  public searchIssues() {
    return this.getAssignedIssues();
  }
  public getIssue() {
    return Promise.resolve(issue);
  }
}

class FakeFactory implements JiraClientFactory {
  public fail = false;
  public issueFailure: Error | undefined;
  public credentials: AtlassianCredential[] = [];
  public create(_baseUrl: string, credential: AtlassianCredential) {
    this.credentials.push(credential);
    return new FakeClient(this.fail, this.issueFailure);
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

  void it("stores Jira Cloud email and API token only in SecretStorage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-jira-cloud-"));
    directories.push(directory);
    const databasePath = getDatabasePath(directory);
    const database = await LocalDatabase.open(databasePath);
    const repository = new JiraRepository(database);
    const secrets = new MemorySecrets();
    const factory = new FakeFactory();
    await new JiraService(repository, secrets, factory).connect(
      "Jira Cloud",
      "https://team.atlassian.net",
      "fake-cloud-token",
      "user@example.com",
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

  void it("keeps a valid connection when assigned issue access is denied", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-jira-perms-"));
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const repository = new JiraRepository(database);
    const secrets = new MemorySecrets();
    const factory = new FakeFactory();
    factory.issueFailure = Object.assign(new Error("denied"), { status: 403 });
    const state = await new JiraService(repository, secrets, factory).connect(
      "Jira",
      "https://jira.example.test",
      "fake",
    );
    assert.equal(state.status, "connected");
    assert.equal(state.currentUser?.displayName, "Test User");
    assert.match(state.message ?? "", /Browse Projects/u);
    assert.ok(repository.getConnection());
    assert.equal(secrets.values.size, 1);
    database.close();
  });

  void it("persists local-only cards without calling Jira", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-jira-local-"));
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const repository = new JiraRepository(database);
    const factory = new FakeFactory();
    const service = new JiraService(repository, new MemorySecrets(), factory);

    await service.createLocalCard("Local investigation", "todo");
    let state = await service.refresh();
    assert.equal(state.localCards[0]?.summary, "Local investigation");
    assert.equal(factory.credentials.length, 0);

    const id = state.localCards[0]?.id;
    assert.ok(id);
    await service.moveLocalCard(id, "in_progress");
    state = await service.refresh();
    assert.equal(state.localCards[0]?.status, "in_progress");
    await service.deleteLocalCard(id);
    assert.equal((await service.refresh()).localCards.length, 0);
    assert.equal(factory.credentials.length, 0);
    database.close();
  });
});
