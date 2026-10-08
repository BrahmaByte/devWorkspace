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
  public getSavedFilters() {
    return Promise.resolve([{ id: "42", name: "Team work" }]);
  }
  public constructor(
    private readonly fail = false,
    private readonly issueFailure?: Error,
    private readonly queries: string[] = [],
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
  public searchIssues(query: string) {
    this.queries.push(query);
    return this.getAssignedIssues();
  }
  public getIssue() {
    return Promise.resolve(issue);
  }
  public getComments() {
    return Promise.resolve({ comments: [] });
  }
  public addComment() {
    return Promise.resolve({
      id: "1",
      author: "Test User",
      createdAt: issue.updatedAt,
      html: "<p>Test</p>",
    });
  }
}

class FakeFactory implements JiraClientFactory {
  public fail = false;
  public issueFailure: Error | undefined;
  public credentials: AtlassianCredential[] = [];
  public queries: string[] = [];
  public create(_baseUrl: string, credential: AtlassianCredential) {
    this.credentials.push(credential);
    return new FakeClient(this.fail, this.issueFailure, this.queries);
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
  void it("rejects saved filters returned after the connection is removed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dashboard-stale-filters-"));
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const factory = new FakeFactory();
    const service = new JiraService(
      new JiraRepository(database),
      new MemorySecrets(),
      factory,
    );
    await service.connect("Jira", "https://jira.example.test", "fake-token");
    let finish!: (value: { id: string; name: string }[]) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const client = new FakeClient();
    client.getSavedFilters = () => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    factory.create = () => client;
    const pending = service.getSavedFilters();
    await ready;
    await service.disconnect();
    finish([{ id: "42", name: "Old filter" }]);
    await assert.rejects(pending, /connection changed/u);
  });
  void it("fetches saved filters without rewriting JQL and persists filter-ID queries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dashboard-saved-filters-"));
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const repository = new JiraRepository(database);
    const secrets = new MemorySecrets();
    const service = new JiraService(repository, secrets, new FakeFactory());
    await assert.rejects(service.getSavedFilters(), /Connect Jira/u);
    await service.connect("Jira", "https://jira.example.test", "fake-token");
    await service.search("project = DEV");
    assert.deepEqual(await service.getSavedFilters(), [
      { id: "42", name: "Team work" },
    ]);
    assert.equal(repository.getFilter(), "project = DEV");
    await service.search("filter = 42");
    assert.equal((await service.refresh()).filter, "filter = 42");
    await service.disconnect();
    await assert.rejects(service.getSavedFilters(), /Connect Jira/u);
  });
  void it("loads five recent assigned issues independently of the saved board filter", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dashboard-recent-jira-"));
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const repository = new JiraRepository(database);
    const secrets = new MemorySecrets();
    const factory = new FakeFactory();
    const service = new JiraService(repository, secrets, factory);
    await service.connect("Jira", "https://jira.example.test", "fake-token");
    await service.search("project = DEV ORDER BY created DESC");
    const client = new FakeClient();
    client.searchIssues = (query: string) => {
      factory.queries.push(query);
      return Promise.resolve(
        Array.from({ length: 7 }, (_, index) => ({
          ...issue,
          key: `DEV-${index + 1}`,
          status: index === 6 ? "Done" : "To Do",
          updatedAt: `2026-10-0${index + 1}T08:00:00.000Z`,
        })),
      );
    };
    factory.create = () => client;
    const recent = await service.getRecentIssues();
    const queryCount = factory.queries.length;
    assert.deepEqual(
      (await service.getRecentIssues(false)).issues,
      recent.issues,
    );
    assert.equal(factory.queries.length, queryCount);
    assert.deepEqual(
      recent.issues.map((item) => item.key),
      ["DEV-7", "DEV-6", "DEV-5", "DEV-4", "DEV-3"],
    );
    assert.equal(recent.issues[0]?.status, "Done");
    assert.equal(
      factory.queries.at(-1),
      "assignee = currentUser() ORDER BY updated DESC",
    );
    assert.equal(repository.getFilter(), "project = DEV ORDER BY created DESC");
    assert.equal(
      repository.listIssues(repository.getConnection()!.id).length,
      1,
    );
    client.searchIssues = () => Promise.reject(new Error("offline"));
    const offline = await service.getRecentIssues();
    assert.deepEqual(offline.issues, recent.issues);
    assert.match(offline.message!, /could not refresh/u);
    secrets.values.clear();
    assert.deepEqual((await service.getRecentIssues()).issues, []);
    await service.connect(
      "Jira",
      "https://jira.example.test",
      "fake-new-token",
    );
    let completeSearch!: (issues: JiraIssue[]) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    client.searchIssues = () =>
      new Promise<JiraIssue[]>((resolve) => {
        completeSearch = resolve;
        markStarted();
      });
    const pending = service.getRecentIssues();
    await started;
    await service.disconnect();
    completeSearch([issue]);
    assert.deepEqual((await pending).issues, []);
    assert.deepEqual((await service.getRecentIssues()).issues, []);
    database.close();
  });
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
    assert.deepEqual(await service.getComments("DEV-7"), { comments: [] });
    assert.equal((await service.addComment("DEV-7", "Hello")).id, "1");
    await assert.rejects(service.addComment("DEV-7", " "), /invalid/u);
    await assert.rejects(service.getComments("DEV-7", -1), /invalid/u);
    await assert.rejects(service.getComments("../bad"), /invalid/u);
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

  void it("persists and reapplies the last custom JQL after local changes", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "devworkspace-jira-filter-"),
    );
    directories.push(directory);
    const databasePath = getDatabasePath(directory);
    const database = await LocalDatabase.open(databasePath);
    const repository = new JiraRepository(database);
    const secrets = new MemorySecrets();
    const factory = new FakeFactory();
    const service = new JiraService(repository, secrets, factory);
    await service.connect("Jira", "https://jira.example.test", "fake");
    const filter = "project = DEV ORDER BY Rank ASC";
    assert.equal((await service.search(filter)).filter, filter);
    await service.createLocalCard("Local follow-up", "todo");
    assert.equal((await service.refresh()).filter, filter);
    assert.deepEqual(factory.queries, [filter, filter]);
    database.close();

    const reopened = await LocalDatabase.open(databasePath);
    const restoredRepository = new JiraRepository(reopened);
    const restored = new JiraService(restoredRepository, secrets, factory);
    assert.equal((await restored.refresh()).filter, filter);
    assert.equal(factory.queries.at(-1), filter);
    reopened.close();
  });
});
