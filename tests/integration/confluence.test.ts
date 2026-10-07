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
  public readPage() {
    return this.fail
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({
          page,
          html: '<h1 data-reader-id="reader-section-1">Runbook</h1>',
          headings: [{ id: "reader-section-1", level: 1, text: "Runbook" }],
        });
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
  void it("deduplicates and bounds short-lived full-text searches, rejects stale connection results and requires credentials on cache hits", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "devworkspace-search-cache-"),
    );
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const repository = new ConfluenceRepository(database);
    const secrets = new MemorySecrets();
    let now = 1000;
    let calls = 0;
    let release: (() => void) | undefined;
    let block = false;
    const searchSignals: AbortSignal[] = [];
    const service = new ConfluenceService(
      repository,
      secrets,
      {
        create: () => ({
          testConnection: () => Promise.resolve(),
          searchPages: async (query, signal) => {
            if (signal) searchSignals.push(signal);
            calls++;
            if (block)
              await new Promise<void>((resolve) => {
                release = resolve;
              });
            return [{ ...page, title: query }];
          },
          readPage: () => Promise.reject(new Error("Not needed")),
        }),
      },
      () => now,
    );
    await service.connect(
      "Docs",
      "https://confluence.example.test",
      "fake-token",
    );
    await Promise.all([
      service.search("body text"),
      service.search("body text"),
    ]);
    assert.equal(calls, 1);
    await service.search("body text");
    assert.equal(calls, 1);
    now += 60_001;
    await service.search("body text");
    assert.equal(calls, 2);
    for (let index = 0; index < 10; index++)
      await service.search(`query ${index}`);
    await service.search("body text");
    assert.equal(calls, 13);
    secrets.values.clear();
    await assert.rejects(service.search("body text"), /credentials/u);
    await secrets.store(
      "devworkspace.confluence." + repository.getConnection()!.id + ".pat",
      "fake-token",
    );
    block = true;
    const oldSearch = service.search("old query");
    await new Promise<void>((resolve) => setImmediate(resolve));
    block = false;
    await service.search("new query");
    assert.equal(searchSignals.at(-2)?.aborted, true);
    release!();
    await oldSearch;
    assert.equal(
      repository.listPages(repository.getConnection()!.id)[0]?.title,
      "new query",
    );
    block = true;
    const stale = service.search("disconnected query");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await service.disconnect();
    assert.equal(searchSignals.at(-1)?.aborted, true);
    release!();
    await assert.rejects(stale, /changed/u);
    assert.equal(repository.getConnection(), undefined);
    assert.doesNotMatch(
      (await readFile(getDatabasePath(directory))).toString(),
      /fake-token/u,
    );
    database.close();
  });
  void it("evicts least-recently-used documents and rejects invalidated in-flight reads", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "devworkspace-reader-cache-"),
    );
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const repository = new ConfluenceRepository(database);
    const pages = Array.from({ length: 6 }, (_, index) => ({
      ...page,
      id: String(index + 1),
    }));
    let reads = 0;
    let release: (() => void) | undefined;
    let block = false;
    const service = new ConfluenceService(repository, new MemorySecrets(), {
      create: () => ({
        testConnection: () => Promise.resolve(),
        searchPages: () => Promise.resolve(pages),
        readPage: async (id, onContent) => {
          reads++;
          if (block)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          const document = {
            page: pages.find((item) => item.id === id)!,
            html: "<p>Private test body</p>",
            headings: [],
          };
          onContent?.({ ...document, mediaLoading: true });
          return document;
        },
      }),
    });
    await service.connect(
      "Docs",
      "https://confluence.example.test",
      "fake-token",
    );
    await service.search("runbook");
    for (const item of pages.slice(0, 5)) await service.readPage(item.id);
    await service.readPage("1");
    await service.readPage("6");
    await service.readPage("1");
    assert.equal(reads, 6);
    await service.readPage("2");
    assert.equal(reads, 7);
    service.clearReaderCache();
    block = true;
    const published: unknown[] = [];
    const pending = service.readPage("1", (document) =>
      published.push(document),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    service.clearReaderCache();
    release!();
    await assert.rejects(pending, /changed/u);
    assert.equal(published.length, 0);
    database.close();
  });
  void it("stores PAT only in SecretStorage and caches bounded page metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-confluence-"));
    directories.push(directory);
    const databasePath = getDatabasePath(directory);
    const database = await LocalDatabase.open(databasePath);
    const repository = new ConfluenceRepository(database);
    const secrets = new MemorySecrets();
    const factory = new FakeFactory();
    let now = 1000;
    const service = new ConfluenceService(
      repository,
      secrets,
      factory,
      () => now,
    );
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
    const reader = await service.readPage("42");
    assert.equal(reader.headings[0]?.text, "Runbook");
    const requests = factory.credentials.length;
    await Promise.all([service.readPage("42"), service.readPage("42")]);
    assert.equal(factory.credentials.length, requests);
    service.clearReaderCache();
    await Promise.all([service.readPage("42"), service.readPage("42")]);
    assert.equal(factory.credentials.length, requests + 1);
    now += 300_001;
    await service.readPage("42");
    assert.equal(factory.credentials.length, requests + 2);
    secrets.values.clear();
    await assert.rejects(service.readPage("42"), /credentials/u);
    await secrets.store(
      "devworkspace.confluence." + state.connection!.id + ".pat",
      "fake-confluence-pat",
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
