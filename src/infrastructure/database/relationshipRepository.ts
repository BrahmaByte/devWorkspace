import type { RelationshipTargetType } from "../../domain/knowledge/models";
import type { LocalDatabase, SqlValue } from "./localDatabase";

export interface StoredRelationship {
  readonly id: string;
  readonly noteId: string;
  readonly targetType: RelationshipTargetType;
  readonly targetId: string;
  readonly createdAt: string;
}
const text = (row: Readonly<Record<string, SqlValue>>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") throw new Error("Invalid relationship data.");
  return value;
};

export class RelationshipRepository {
  public constructor(private readonly database: LocalDatabase) {}
  public listForNote(noteId: string): readonly StoredRelationship[] {
    return this.database
      .query(
        "SELECT * FROM relationships WHERE source_type='note' AND source_id=? ORDER BY created_at;",
        [noteId],
      )
      .map((row) => ({
        id: text(row, "id"),
        noteId: text(row, "source_id"),
        targetType: text(row, "target_type") as RelationshipTargetType,
        targetId: text(row, "target_id"),
        createdAt: text(row, "created_at"),
      }));
  }
  public async create(value: StoredRelationship): Promise<void> {
    this.database.run(
      "INSERT INTO relationships(id,source_type,source_id,target_type,target_id,created_at) VALUES(?,'note',?,?,?,?);",
      [
        value.id,
        value.noteId,
        value.targetType,
        value.targetId,
        value.createdAt,
      ],
    );
    await this.database.persist();
  }
  public async delete(id: string): Promise<void> {
    this.database.run("DELETE FROM relationships WHERE id=?;", [id]);
    await this.database.persist();
  }
  public async deleteForResource(
    type: "note" | "project",
    id: string,
  ): Promise<void> {
    this.database.run(
      "DELETE FROM relationships WHERE (source_type=? AND source_id=?) OR (target_type=? AND target_id=?);",
      [type, id, type, id],
    );
    await this.database.persist();
  }
}
