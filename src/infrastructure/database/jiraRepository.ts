import type { JiraConnection, JiraIssue } from "../../domain/jira/models";
import type { LocalDatabase, SqlValue } from "./localDatabase";

const text = (row: Readonly<Record<string, SqlValue>>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") throw new Error("Invalid Jira data.");
  return value;
};

export class JiraRepository {
  public constructor(private readonly database: LocalDatabase) {}

  public getConnection(): JiraConnection | undefined {
    const row = this.database.query(
      "SELECT * FROM jira_connections ORDER BY updated_at DESC LIMIT 1;",
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

  public async saveConnection(connection: JiraConnection): Promise<void> {
    this.database.run("DELETE FROM jira_connections WHERE id <> ?;", [
      connection.id,
    ]);
    this.database.run(
      "INSERT INTO jira_connections(id,base_url,display_name,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url,display_name=excluded.display_name,updated_at=excluded.updated_at;",
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

  public async replaceIssues(
    connectionId: string,
    issues: readonly JiraIssue[],
  ): Promise<void> {
    this.database.run("DELETE FROM jira_issue_cache WHERE connection_id=?;", [
      connectionId,
    ]);
    for (const issue of issues)
      this.database.run(
        "INSERT INTO jira_issue_cache(id,connection_id,external_id,issue_key,summary,status,updated_at) VALUES(?,?,?,?,?,?,?);",
        [
          randomCacheId(connectionId, issue.id),
          connectionId,
          issue.id,
          issue.key,
          issue.summary,
          issue.status,
          issue.updatedAt,
        ],
      );
    await this.database.persist();
  }

  public listIssues(connectionId: string): readonly JiraIssue[] {
    return this.database
      .query(
        "SELECT * FROM jira_issue_cache WHERE connection_id=? ORDER BY updated_at DESC;",
        [connectionId],
      )
      .map((row) => ({
        id: text(row, "external_id"),
        key: text(row, "issue_key"),
        summary: text(row, "summary"),
        status: text(row, "status"),
        updatedAt: text(row, "updated_at"),
      }));
  }

  public async deleteConnection(id: string): Promise<void> {
    this.database.run("DELETE FROM jira_connections WHERE id=?;", [id]);
    await this.database.persist();
  }
}

function randomCacheId(connectionId: string, externalId: string): string {
  return `${connectionId}:${externalId}`;
}
