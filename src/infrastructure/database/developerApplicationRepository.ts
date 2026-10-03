import type { DeveloperApplication } from "../../domain/apps/models";
import type { LocalDatabase, SqlValue } from "./localDatabase";

const text = (row: Readonly<Record<string, SqlValue>>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string")
    throw new Error("Invalid developer application data.");
  return value;
};

const optionalText = (
  row: Readonly<Record<string, SqlValue>>,
  key: string,
): string | undefined => {
  const value = row[key];
  if (value === null) return undefined;
  if (typeof value !== "string")
    throw new Error("Invalid developer application data.");
  return value;
};

const mapApplication = (
  row: Readonly<Record<string, SqlValue>>,
): DeveloperApplication => ({
  id: text(row, "id"),
  name: text(row, "name"),
  executablePath: text(row, "executable_path"),
  createdAt: text(row, "created_at"),
  updatedAt: text(row, "updated_at"),
  lastLaunchedAt: optionalText(row, "last_launched_at"),
});

export class DeveloperApplicationRepository {
  public constructor(private readonly database: LocalDatabase) {}

  public list(): readonly DeveloperApplication[] {
    return this.database
      .query("SELECT * FROM developer_applications ORDER BY updated_at DESC;")
      .map(mapApplication);
  }

  public get(id: string): DeveloperApplication | undefined {
    const row = this.database.query(
      "SELECT * FROM developer_applications WHERE id=?;",
      [id],
    )[0];
    return row ? mapApplication(row) : undefined;
  }

  public async save(application: DeveloperApplication): Promise<void> {
    this.database.run(
      "INSERT INTO developer_applications(id,name,executable_path,last_launched_at,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,executable_path=excluded.executable_path,last_launched_at=excluded.last_launched_at,updated_at=excluded.updated_at;",
      [
        application.id,
        application.name,
        application.executablePath,
        application.lastLaunchedAt ?? null,
        application.createdAt,
        application.updatedAt,
      ],
    );
    await this.database.persist();
  }

  public async delete(id: string): Promise<void> {
    this.database.run("DELETE FROM developer_applications WHERE id=?;", [id]);
    await this.database.persist();
  }
}
