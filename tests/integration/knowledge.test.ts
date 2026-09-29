import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { KnowledgeService } from "../../src/application/services/knowledgeService";
import { WorkspaceService } from "../../src/application/services/workspaceService";
import { ConfluenceRepository } from "../../src/infrastructure/database/confluenceRepository";
import { JiraRepository } from "../../src/infrastructure/database/jiraRepository";
import { getDatabasePath } from "../../src/infrastructure/database/location";
import { LocalDatabase } from "../../src/infrastructure/database/localDatabase";
import { NoteRepository } from "../../src/infrastructure/database/noteRepository";
import { RelationshipRepository } from "../../src/infrastructure/database/relationshipRepository";
import { WorkspaceRepository } from "../../src/infrastructure/database/workspaceRepository";

const directories: string[] = [];
void afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

void describe("knowledge relationships", () => {
  void it("creates, restores, detaches, and cleans up note links", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-knowledge-"));
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const notes = new NoteRepository(database);
    const workspace = new WorkspaceRepository(database);
    const relationships = new RelationshipRepository(database);
    const noteId = "00000000-0000-4000-8000-000000000001";
    await notes.create({
      id: noteId,
      title: "Context",
      content: "",
      now: new Date().toISOString(),
    });
    const projectId = await new WorkspaceService(
      workspace,
      "linux",
    ).createProject("API", "/work/api");
    const service = new KnowledgeService(
      relationships,
      notes,
      new JiraRepository(database),
      new ConfluenceRepository(database),
      workspace,
    );
    await service.attach(noteId, "project", projectId);
    const state = service.getState(noteId);
    assert.equal(state.links[0]?.label, "API");
    const relationshipId = state.links[0]?.relationshipId;
    assert.ok(relationshipId);
    await service.detach(noteId, relationshipId);
    assert.equal(service.getState(noteId).links.length, 0);
    await service.attach(noteId, "project", projectId);
    await service.deleteForResource("note", noteId);
    assert.equal(relationships.listForNote(noteId).length, 0);
    database.close();
  });

  void it("retains unavailable external links as stale offline context", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "devworkspace-knowledge-stale-"),
    );
    directories.push(directory);
    const database = await LocalDatabase.open(getDatabasePath(directory));
    const notes = new NoteRepository(database);
    const relationships = new RelationshipRepository(database);
    const noteId = "00000000-0000-4000-8000-000000000002";
    await notes.create({
      id: noteId,
      title: "Offline",
      content: "",
      now: new Date().toISOString(),
    });
    await relationships.create({
      id: "00000000-0000-4000-8000-000000000003",
      noteId,
      targetType: "jira_issue",
      targetId: "DEV-404",
      createdAt: new Date().toISOString(),
    });
    const service = new KnowledgeService(
      relationships,
      notes,
      new JiraRepository(database),
      new ConfluenceRepository(database),
      new WorkspaceRepository(database),
    );
    const state = service.getState(noteId);
    assert.equal(state.links[0]?.stale, true);
    assert.equal(state.links[0]?.id, "DEV-404");
    database.close();
  });
});
