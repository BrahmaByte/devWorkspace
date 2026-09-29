import { randomUUID } from "node:crypto";

import type { StickyColor } from "../../domain/notes/models";
import type { NoteRepository } from "../../infrastructure/database/noteRepository";

export const noteLimits = {
  title: 200,
  content: 500_000,
  search: 200,
  stickyContent: 10_000,
} as const;

export class NoteService {
  public constructor(private readonly repository: NoteRepository) {}

  public getState(query = "") {
    this.requireLength(query, noteLimits.search, "Search query");
    return {
      notes: this.repository.list(query),
      stickyNotes: this.repository.listStickyNotes(),
    };
  }

  public async createNote(title: string, content: string): Promise<string> {
    this.validateNote(title, content);
    const id = randomUUID();
    await this.repository.create({
      id,
      title: title.trim(),
      content,
      now: new Date().toISOString(),
    });
    return id;
  }

  public updateNote(id: string, title: string, content: string): Promise<void> {
    this.requireId(id);
    this.validateNote(title, content);
    return this.repository.update(
      id,
      title.trim(),
      content,
      new Date().toISOString(),
    );
  }

  public setPinned(id: string, pinned: boolean): Promise<void> {
    this.requireId(id);
    return this.repository.setPinned(id, pinned, new Date().toISOString());
  }

  public setArchived(id: string, archived: boolean): Promise<void> {
    this.requireId(id);
    return this.repository.setArchived(id, archived, new Date().toISOString());
  }

  public deleteNote(id: string): Promise<void> {
    this.requireId(id);
    return this.repository.delete(id);
  }

  public createStickyNote(
    content: string,
    color: StickyColor,
    sortOrder: number,
  ): Promise<void> {
    this.validateSticky(content, sortOrder);
    const now = new Date().toISOString();
    return this.repository.createStickyNote({
      id: randomUUID(),
      content,
      color,
      sortOrder,
      now,
    });
  }

  public updateStickyNote(
    id: string,
    content: string,
    color: StickyColor,
    sortOrder: number,
  ): Promise<void> {
    this.requireId(id);
    this.validateSticky(content, sortOrder);
    return this.repository.updateStickyNote(
      id,
      content,
      color,
      sortOrder,
      new Date().toISOString(),
    );
  }

  public deleteStickyNote(id: string): Promise<void> {
    this.requireId(id);
    return this.repository.deleteStickyNote(id);
  }

  private validateNote(title: string, content: string): void {
    if (title.trim().length === 0) throw new Error("A note title is required.");
    this.requireLength(title, noteLimits.title, "Note title");
    this.requireLength(content, noteLimits.content, "Note content");
  }

  private validateSticky(content: string, sortOrder: number): void {
    if (content.trim().length === 0)
      throw new Error("Sticky note content is required.");
    this.requireLength(
      content,
      noteLimits.stickyContent,
      "Sticky note content",
    );
    if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000)
      throw new Error("Invalid sticky note order.");
  }

  private requireId(id: string): void {
    if (!/^[0-9a-f-]{36}$/iu.test(id))
      throw new Error("Invalid note identifier.");
  }

  private requireLength(value: string, maximum: number, label: string): void {
    if (value.length > maximum) throw new Error(`${label} is too long.`);
  }
}
