import type {
  ConfluenceConnection,
  ConfluencePage,
} from "../../domain/confluence/models";
import type { LocalDatabase, SqlValue } from "./localDatabase";

const text = (row: Readonly<Record<string, SqlValue>>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") throw new Error("Invalid Confluence data.");
  return value;
};

export class ConfluenceRepository {
  public constructor(private readonly database: LocalDatabase) {}

  public getConnection(): ConfluenceConnection | undefined {
    const row = this.database.query(
      "SELECT * FROM confluence_connections ORDER BY updated_at DESC LIMIT 1;",
    )[0];
    return row
      ? {
          id: text(row, "id"),
          baseUrl: text(row, "base_url"),
          displayName: text(row, "display_name"),
          createdAt: text(row, "created_at"),
          updatedAt: text(row, "updated_at"),
        }
      : undefined;
  }

  public async saveConnection(connection: ConfluenceConnection): Promise<void> {
    this.database.run("DELETE FROM confluence_connections WHERE id <> ?;", [
      connection.id,
    ]);
    this.database.run(
      "INSERT INTO confluence_connections(id,base_url,display_name,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url,display_name=excluded.display_name,updated_at=excluded.updated_at;",
      [
        connection.id,
        connection.baseUrl,
        connection.displayName,
        connection.createdAt,
        connection.updatedAt,
      ],
    );
    await this.database.persist();
  }

  public async replacePages(
    connectionId: string,
    pages: readonly ConfluencePage[],
  ): Promise<void> {
    this.database.run(
      "DELETE FROM confluence_page_cache WHERE connection_id=?;",
      [connectionId],
    );
    for (const page of pages)
      this.database.run(
        "INSERT INTO confluence_page_cache(id,connection_id,external_id,title,web_url,updated_at) VALUES(?,?,?,?,?,?);",
        [
          `${connectionId}:${page.id}`,
          connectionId,
          page.id,
          page.title,
          page.webUrl,
          page.updatedAt,
        ],
      );
    await this.database.persist();
  }

  public listPages(connectionId: string): readonly ConfluencePage[] {
    return this.database
      .query(
        "SELECT * FROM confluence_page_cache WHERE connection_id=? ORDER BY updated_at DESC;",
        [connectionId],
      )
      .map((row) => ({
        id: text(row, "external_id"),
        title: text(row, "title"),
        webUrl: text(row, "web_url"),
        updatedAt: text(row, "updated_at"),
      }));
  }

  public async deleteConnection(id: string): Promise<void> {
    this.database.run("DELETE FROM confluence_connections WHERE id=?;", [id]);
    await this.database.persist();
  }
}
