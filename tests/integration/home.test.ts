import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { HomeService } from "../../src/application/services/homeService";
import { NoteService } from "../../src/application/services/noteService";
import { getDatabasePath } from "../../src/infrastructure/database/location";
import { LocalDatabase } from "../../src/infrastructure/database/localDatabase";
import { NoteRepository } from "../../src/infrastructure/database/noteRepository";
import { UrlGroupRepository } from "../../src/infrastructure/database/urlGroupRepository";
import { UrlGroupService } from "../../src/application/services/urlGroupService";
import {
  DeveloperApplicationService,
  type DeveloperApplicationProcessGateway,
} from "../../src/application/services/developerApplicationService";
import { DeveloperApplicationRepository } from "../../src/infrastructure/database/developerApplicationRepository";

const inactiveApplications: DeveloperApplicationProcessGateway = {
  inspect: () => Promise.resolve({ name: "Application" }),
  launch: () => Promise.reject(new Error("Not used by this test.")),
};

const applicationService = (
  database: LocalDatabase,
): DeveloperApplicationService =>
  new DeveloperApplicationService(
    new DeveloperApplicationRepository(database),
    inactiveApplications,
  );

const directories: string[] = [];

void afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

void describe("home dashboard", () => {
  void it("edits URL groups safely and restores the same group after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dashboard-url-edit-"));
    directories.push(directory);
    const path = getDatabasePath(directory);
    const database = await LocalDatabase.open(path);
    const service = new UrlGroupService(new UrlGroupRepository(database));
    await service.create("Original", ["https://example.test/old"]);
    const original = service.list()[0]!;
    await service.update(original.id, " New name ", [
      "https://example.test/new",
      "https://example.test/new",
    ]);
    assert.deepEqual(service.list()[0]?.urls, ["https://example.test/new"]);
    assert.equal(service.list()[0]?.createdAt, original.createdAt);
    await assert.rejects(
      service.update(original.id, "Unsafe", ["https://user:pass@example.test"]),
      /HTTPS/u,
    );
    await assert.rejects(
      service.update("missing", "Missing", ["https://example.test"]),
      /not found/u,
    );
    assert.equal(service.list()[0]?.name, "New name");
    database.close();
    const reopened = await LocalDatabase.open(path);
    const restored = new UrlGroupRepository(reopened).list();
    assert.equal(restored.length, 1);
    assert.equal(restored[0]?.id, original.id);
    assert.equal(restored[0]?.name, "New name");
    reopened.close();
  });
  void it("restores local dashboard state and tolerates missing Jira", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-home-"));
    directories.push(directory);
    const databasePath = getDatabasePath(directory);
    const database = await LocalDatabase.open(databasePath);
    const notes = new NoteService(new NoteRepository(database));
    await notes.createNote("Runbook", "Local recovery steps");
    await notes.createStickyNote("Review logs", "yellow", 0);
    await new UrlGroupService(new UrlGroupRepository(database)).create(
      "Daily tools",
      ["https://example.test/dashboard"],
    );
    await assert.rejects(
      new UrlGroupService(new UrlGroupRepository(database)).create("Unsafe", [
        "http://example.test",
      ]),
      /HTTPS/u,
    );
    database.close();

    const reopened = await LocalDatabase.open(databasePath);
    const state = new HomeService(
      new NoteRepository(reopened),
      new UrlGroupRepository(reopened),
      applicationService(reopened),
    ).getState();
    assert.equal(state.stickyNotes[0]?.content, "Review logs");
    assert.equal(state.urlGroups[0]?.name, "Daily tools");
    reopened.close();
  });

  void it("returns useful empty states without integrations or local data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-home-empty-"));
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const state = new HomeService(
      new NoteRepository(database),
      new UrlGroupRepository(database),
      applicationService(database),
    ).getState();
    assert.deepEqual(state.developerApplications, []);
    assert.deepEqual(Object.keys(state).sort(), [
      "developerApplications",
      "stickyNotes",
      "urlGroups",
    ]);
    assert.deepEqual(state.stickyNotes, []);
    assert.deepEqual(state.urlGroups, []);
    database.close();
  });
});
