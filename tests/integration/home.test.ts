import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { HomeService } from "../../src/application/services/homeService";
import { NoteService } from "../../src/application/services/noteService";
import { WorkspaceService } from "../../src/application/services/workspaceService";
import { getDatabasePath } from "../../src/infrastructure/database/location";
import { LocalDatabase } from "../../src/infrastructure/database/localDatabase";
import { NoteRepository } from "../../src/infrastructure/database/noteRepository";
import { WorkspaceRepository } from "../../src/infrastructure/database/workspaceRepository";
import { UrlGroupRepository } from "../../src/infrastructure/database/urlGroupRepository";
import { UrlGroupService } from "../../src/application/services/urlGroupService";

const directories: string[] = [];

void afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

void describe("home dashboard", () => {
  void it("restores local dashboard state and tolerates missing Jira", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-home-"));
    directories.push(directory);
    const databasePath = getDatabasePath(directory);
    const database = await LocalDatabase.open(databasePath);
    const workspaceRepository = new WorkspaceRepository(database);
    const noteRepository = new NoteRepository(database);
    const workspace = new WorkspaceService(workspaceRepository, "linux");
    const notes = new NoteService(noteRepository);
    const projectId = await workspace.createProject("Local API", "/work/api");
    await workspace.setFavourite(projectId, true);
    await workspace.createCommand(
      undefined,
      "Test",
      "npm test",
      "linux",
      "/bin/sh",
      undefined,
      "always",
    );
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
      new WorkspaceRepository(reopened),
      new NoteRepository(reopened),
      new UrlGroupRepository(reopened),
    ).getState();
    assert.equal(state.currentProject?.name, "Local API");
    assert.equal(state.favouriteProjects[0]?.id, projectId);
    assert.equal(state.quickCommands[0]?.name, "Test");
    assert.equal(state.stickyNotes[0]?.content, "Review logs");
    assert.equal(state.urlGroups[0]?.name, "Daily tools");
    assert.deepEqual(state.jira, { connected: false });
    assert.deepEqual(
      new Set(state.recentResources.map((resource) => resource.type)),
      new Set(["project", "note"]),
    );
    reopened.close();
  });

  void it("returns useful empty states without integrations or local data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-home-empty-"));
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const state = new HomeService(
      new WorkspaceRepository(database),
      new NoteRepository(database),
      new UrlGroupRepository(database),
    ).getState();
    assert.equal(state.currentProject, undefined);
    assert.deepEqual(state.favouriteProjects, []);
    assert.deepEqual(state.recentResources, []);
    assert.equal(state.jira.connected, false);
    database.close();
  });
});
