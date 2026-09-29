import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  LocalSearchProvider,
  SearchService,
  type SearchProvider,
} from "../../src/application/services/searchService";
import { NoteService } from "../../src/application/services/noteService";
import { WorkspaceService } from "../../src/application/services/workspaceService";
import { getDatabasePath } from "../../src/infrastructure/database/location";
import { LocalDatabase } from "../../src/infrastructure/database/localDatabase";
import { NoteRepository } from "../../src/infrastructure/database/noteRepository";
import { WorkspaceRepository } from "../../src/infrastructure/database/workspaceRepository";

const directories: string[] = [];
void afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
void describe("global search", () => {
  void it("searches local notes, projects, and commands without interpreting content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-search-"));
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const notes = new NoteRepository(database);
    const workspace = new WorkspaceRepository(database);
    await new NoteService(notes).createNote(
      "<img onerror=alert(1)>",
      "Release runbook",
    );
    const workspaceService = new WorkspaceService(workspace, "linux");
    await workspaceService.createProject("Release API", "/work/release");
    await workspaceService.createCommand(
      undefined,
      "Release check",
      "npm  run test",
      "linux",
      "/bin/sh",
      undefined,
      "always",
    );
    const state = new SearchService([
      new LocalSearchProvider(notes, workspace),
    ]).search("release");
    assert.deepEqual(
      new Set(state.results.map((item) => item.type)),
      new Set(["note", "project", "command"]),
    );
    assert.equal(
      state.results.find((item) => item.type === "note")?.title,
      "<img onerror=alert(1)>",
    );
    database.close();
  });
  void it("returns partial results and reports unavailable providers", () => {
    const available: SearchProvider = {
      name: "Available",
      search: () => [
        { id: "1", type: "jira_issue", title: "DEV-1", detail: "Found" },
      ],
    };
    const unavailable: SearchProvider = {
      name: "Unavailable",
      search: () => {
        throw new Error("offline");
      },
    };
    const state = new SearchService([available, unavailable]).search("dev");
    assert.equal(state.results.length, 1);
    assert.deepEqual(state.unavailableProviders, ["Unavailable"]);
  });
});
