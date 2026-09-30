import type { UrlGroup } from "../../domain/home/urlGroups";
import type { LocalDatabase, SqlValue } from "./localDatabase";

const text = (row: Readonly<Record<string, SqlValue>>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") throw new Error("Invalid URL group data.");
  return value;
};

export class UrlGroupRepository {
  public constructor(private readonly database: LocalDatabase) {}

  public list(): readonly UrlGroup[] {
    return this.database
      .query("SELECT * FROM url_groups ORDER BY updated_at DESC;")
      .map((row) => {
        const parsed: unknown = JSON.parse(text(row, "urls_json"));
        if (
          !Array.isArray(parsed) ||
          !parsed.every((url) => typeof url === "string")
        )
          throw new Error("Invalid URL group data.");
        return {
          id: text(row, "id"),
          name: text(row, "name"),
          urls: parsed,
          createdAt: text(row, "created_at"),
          updatedAt: text(row, "updated_at"),
        };
      });
  }

  public async save(group: UrlGroup): Promise<void> {
    this.database.run(
      "INSERT INTO url_groups(id,name,urls_json,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,urls_json=excluded.urls_json,updated_at=excluded.updated_at;",
      [
        group.id,
        group.name,
        JSON.stringify(group.urls),
        group.createdAt,
        group.updatedAt,
      ],
    );
    await this.database.persist();
  }

  public async delete(id: string): Promise<void> {
    this.database.run("DELETE FROM url_groups WHERE id=?;", [id]);
    await this.database.persist();
  }
}
