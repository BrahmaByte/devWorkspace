import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import { migrations } from "./migrations";

export type SqlParameter = string | number | Uint8Array | null;
export type SqlValue = string | number | Uint8Array | null;

let sqliteRuntime: Promise<SqlJsStatic> | undefined;

function loadSqlite(): Promise<SqlJsStatic> {
  sqliteRuntime ??= initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
  });
  return sqliteRuntime;
}

export class DatabaseInitializationError extends Error {
  public constructor() {
    super("DevWorkspace could not initialize its local database.");
    this.name = "DatabaseInitializationError";
  }
}

export class LocalDatabase {
  private constructor(
    private readonly filePath: string,
    private readonly database: Database,
  ) {}

  public static async open(filePath: string): Promise<LocalDatabase> {
    try {
      const SQL = await loadSqlite();
      let bytes: Uint8Array | undefined;
      try {
        bytes = await readFile(filePath);
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )) {
          throw error;
        }
      }
      const localDatabase = new LocalDatabase(
        filePath,
        bytes === undefined ? new SQL.Database() : new SQL.Database(bytes),
      );
      localDatabase.database.run("PRAGMA foreign_keys = ON;");
      await localDatabase.applyMigrations();
      return localDatabase;
    } catch {
      throw new DatabaseInitializationError();
    }
  }

  public run(sql: string, parameters: readonly SqlParameter[] = []): void {
    this.database.run(sql, [...parameters]);
  }

  public getScalar(
    sql: string,
    parameters: readonly SqlParameter[] = [],
  ): unknown {
    const statement = this.database.prepare(sql, [...parameters]);
    try {
      return statement.step() ? statement.get()[0] : undefined;
    } finally {
      statement.free();
    }
  }

  public query(
    sql: string,
    parameters: readonly SqlParameter[] = [],
  ): readonly Readonly<Record<string, SqlValue>>[] {
    const statement = this.database.prepare(sql, [...parameters]);
    try {
      const rows: Array<Readonly<Record<string, SqlValue>>> = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  public getTableNames(): readonly string[] {
    const result = this.database.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    )[0];
    return result === undefined
      ? []
      : result.values.map(([name]) => String(name));
  }

  public getConnectionColumnNames(
    table: "jira_connections" | "confluence_connections",
  ): readonly string[] {
    const result = this.database.exec(`PRAGMA table_info(${table});`)[0];
    return result === undefined
      ? []
      : result.values.map((row) => String(row[1]));
  }

  public async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const bytes = this.database.export();
    this.database.run("PRAGMA foreign_keys = ON;");
    await writeFile(this.filePath, bytes);
  }

  public close(): void {
    this.database.close();
  }

  private async applyMigrations(): Promise<void> {
    this.database.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);
    const currentVersion = Number(
      this.getScalar(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations;",
      ),
    );
    for (const migration of migrations) {
      if (migration.version <= currentVersion) continue;
      this.database.run("BEGIN;");
      try {
        this.database.run(migration.sql);
        this.database.run(
          "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?);",
          [migration.version, migration.name, new Date().toISOString()],
        );
        this.database.run("COMMIT;");
      } catch (error) {
        this.database.run("ROLLBACK;");
        throw error;
      }
    }
    await this.persist();
  }
}
