import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { NoteService } from "../../src/application/services/noteService";
import { getDatabasePath } from "../../src/infrastructure/database/location";
import { LocalDatabase } from "../../src/infrastructure/database/localDatabase";
import { NoteRepository } from "../../src/infrastructure/database/noteRepository";

const directories: string[] = [];

async function openNotes() {
  const directory = await mkdtemp(join(tmpdir(), "devworkspace-notes-"));
  directories.push(directory);
  const filePath = getDatabasePath(directory);
  const database = await LocalDatabase.open(filePath);
  return {
    database,
    filePath,
    service: new NoteService(new NoteRepository(database)),
  };
}

void afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

void describe("local notes", () => {
  void it("creates, searches, edits, pins, archives, and deletes notes", async () => {
    const { database, service } = await openNotes();
    const createdId = await service.createNote(
      "Release plan",
      "Ship the local workspace",
    );
    assert.match(createdId, /^[0-9a-f-]{36}$/u);
    await service.createNote("Other", "Unrelated");
    const found = service.getState("workspace").notes;
    assert.equal(found.length, 1);
    const note = found[0];
    assert.ok(note);
    await service.updateNote(note.id, "Updated plan", "Workspace ready");
    await service.setPinned(note.id, true);
    await service.setArchived(note.id, true);
    const updated = service.getState("Updated").notes[0];
    assert.equal(updated?.isPinned, true);
    assert.equal(updated?.isArchived, true);
    await service.deleteNote(note.id);
    assert.equal(service.getState("Updated").notes.length, 0);
    database.close();
  });

  void it("persists large plain-text notes and sticky notes across restart", async () => {
    const { database, filePath, service } = await openNotes();
    const payload = `<img src=x onerror=alert(1)>${"x".repeat(100_000)}`;
    await service.createNote("<script>alert(1)</script>", payload);
    await service.createStickyNote("Do not render <b>HTML</b>", "pink", 2);
    database.close();

    const reopened = await LocalDatabase.open(filePath);
    const restored = new NoteService(new NoteRepository(reopened)).getState();
    assert.equal(restored.notes[0]?.content, payload);
    assert.equal(restored.notes[0]?.title, "<script>alert(1)</script>");
    assert.equal(restored.stickyNotes[0]?.color, "pink");
    reopened.close();
  });

  void it("treats SQL wildcard characters as literal search text", async () => {
    const { database, service } = await openNotes();
    await service.createNote("100% done", "literal_under_score");
    await service.createNote("Other", "anything");
    assert.equal(service.getState("%").notes.length, 1);
    assert.equal(service.getState("_").notes.length, 1);
    database.close();
  });
});
