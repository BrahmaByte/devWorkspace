import type { LocalDatabase } from "./localDatabase";

export interface NewProject {
  readonly id: string;
  readonly name: string;
  readonly localPath: string;
}

export interface NewNote {
  readonly id: string;
  readonly title: string;
  readonly content: string;
}

export class LocalStateRepository {
  public constructor(private readonly database: LocalDatabase) {}

  public getSchemaVersion(): number {
    return Number(
      this.database.getScalar(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations;",
      ),
    );
  }

  public async createProject(project: NewProject): Promise<void> {
    const now = new Date().toISOString();
    this.database.run(
      "INSERT INTO projects(id, name, local_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?);",
      [project.id, project.name, project.localPath, now, now],
    );
    await this.database.persist();
  }

  public async createNote(note: NewNote): Promise<void> {
    const now = new Date().toISOString();
    this.database.run(
      "INSERT INTO notes(id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?);",
      [note.id, note.title, note.content, now, now],
    );
    await this.database.persist();
  }

  public async createRelationship(
    id: string,
    sourceType: string,
    sourceId: string,
    targetType: string,
    targetId: string,
  ): Promise<void> {
    this.database.run(
      "INSERT INTO relationships(id, source_type, source_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?);",
      [
        id,
        sourceType,
        sourceId,
        targetType,
        targetId,
        new Date().toISOString(),
      ],
    );
    await this.database.persist();
  }

  public count(table: "notes" | "projects" | "relationships"): number {
    return Number(this.database.getScalar(`SELECT COUNT(*) FROM ${table};`));
  }
}
