import type { Note, StickyColor, StickyNote } from "../../domain/notes/models";
import type { LocalDatabase, SqlValue } from "./localDatabase";

export interface NoteWrite {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly now: string;
}

export interface StickyNoteWrite {
  readonly id: string;
  readonly content: string;
  readonly color: StickyColor;
  readonly sortOrder: number;
  readonly now: string;
}

function stringValue(
  row: Readonly<Record<string, SqlValue>>,
  key: string,
): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error("Invalid local note data.");
  return value;
}

function numberValue(
  row: Readonly<Record<string, SqlValue>>,
  key: string,
): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error("Invalid local note data.");
  return value;
}

function toNote(row: Readonly<Record<string, SqlValue>>): Note {
  return {
    id: stringValue(row, "id"),
    title: stringValue(row, "title"),
    content: stringValue(row, "content"),
    isPinned: numberValue(row, "is_pinned") === 1,
    isArchived: numberValue(row, "is_archived") === 1,
    createdAt: stringValue(row, "created_at"),
    updatedAt: stringValue(row, "updated_at"),
  };
}

function toStickyNote(row: Readonly<Record<string, SqlValue>>): StickyNote {
  return {
    id: stringValue(row, "id"),
    content: stringValue(row, "content"),
    color: stringValue(row, "color") as StickyColor,
    sortOrder: numberValue(row, "sort_order"),
    createdAt: stringValue(row, "created_at"),
    updatedAt: stringValue(row, "updated_at"),
  };
}

export class NoteRepository {
  public constructor(private readonly database: LocalDatabase) {}

  public list(query = ""): readonly Note[] {
    const normalized = query.trim();
    const rows =
      normalized.length === 0
        ? this.database.query(
            "SELECT * FROM notes ORDER BY is_pinned DESC, updated_at DESC;",
          )
        : this.database.query(
            "SELECT * FROM notes WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' ORDER BY is_pinned DESC, updated_at DESC;",
            [this.likePattern(normalized), this.likePattern(normalized)],
          );
    return rows.map(toNote);
  }

  public async create(note: NoteWrite): Promise<void> {
    this.database.run(
      "INSERT INTO notes(id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?);",
      [note.id, note.title, note.content, note.now, note.now],
    );
    await this.database.persist();
  }

  public async update(
    id: string,
    title: string,
    content: string,
    now: string,
  ): Promise<void> {
    this.requireNote(id);
    this.database.run(
      "UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?;",
      [title, content, now, id],
    );
    await this.database.persist();
  }

  public async setPinned(
    id: string,
    pinned: boolean,
    now: string,
  ): Promise<void> {
    this.requireNote(id);
    this.database.run(
      "UPDATE notes SET is_pinned = ?, updated_at = ? WHERE id = ?;",
      [pinned ? 1 : 0, now, id],
    );
    await this.database.persist();
  }

  public async setArchived(
    id: string,
    archived: boolean,
    now: string,
  ): Promise<void> {
    this.requireNote(id);
    this.database.run(
      "UPDATE notes SET is_archived = ?, updated_at = ? WHERE id = ?;",
      [archived ? 1 : 0, now, id],
    );
    await this.database.persist();
  }

  public async delete(id: string): Promise<void> {
    this.requireNote(id);
    this.database.run("DELETE FROM notes WHERE id = ?;", [id]);
    await this.database.persist();
  }

  public listStickyNotes(): readonly StickyNote[] {
    return this.database
      .query("SELECT * FROM sticky_notes ORDER BY sort_order, updated_at DESC;")
      .map(toStickyNote);
  }

  public async createStickyNote(note: StickyNoteWrite): Promise<void> {
    this.database.run(
      "INSERT INTO sticky_notes(id, content, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?);",
      [note.id, note.content, note.color, note.sortOrder, note.now, note.now],
    );
    await this.database.persist();
  }

  public async updateStickyNote(
    id: string,
    content: string,
    color: StickyColor,
    sortOrder: number,
    now: string,
  ): Promise<void> {
    this.requireStickyNote(id);
    this.database.run(
      "UPDATE sticky_notes SET content = ?, color = ?, sort_order = ?, updated_at = ? WHERE id = ?;",
      [content, color, sortOrder, now, id],
    );
    await this.database.persist();
  }

  public async deleteStickyNote(id: string): Promise<void> {
    this.requireStickyNote(id);
    this.database.run("DELETE FROM sticky_notes WHERE id = ?;", [id]);
    await this.database.persist();
  }

  private requireNote(id: string): void {
    if (
      Number(
        this.database.getScalar("SELECT COUNT(*) FROM notes WHERE id = ?;", [
          id,
        ]),
      ) !== 1
    )
      throw new Error("Note not found.");
  }

  private requireStickyNote(id: string): void {
    if (
      Number(
        this.database.getScalar(
          "SELECT COUNT(*) FROM sticky_notes WHERE id = ?;",
          [id],
        ),
      ) !== 1
    )
      throw new Error("Sticky note not found.");
  }

  private likePattern(query: string): string {
    return `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  }
}
