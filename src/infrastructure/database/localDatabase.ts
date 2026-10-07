import {
  mkdir,
  readFile,
  open,
  rename,
  unlink,
  readdir,
  lstat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import { migrations } from "./migrations";

export type SqlParameter = string | number | Uint8Array | null;
export type SqlValue = string | number | Uint8Array | null;

let sqliteRuntime: Promise<SqlJsStatic> | undefined;
const MAX_DATABASE_BYTES = 128 * 1024 * 1024;
const SNAPSHOT_LIMIT = 10;
const SNAPSHOT_NAME =
  /^snapshot-\d{13}-(automatic|manual|migration|before-restore)-[a-f0-9-]{36}\.sqlite$/u;
const MIGRATION_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);`;
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    });
  }
}

async function readDatabaseFile(path: string): Promise<Uint8Array | undefined> {
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > MAX_DATABASE_BYTES
    )
      throw new Error("Database must be a regular file no larger than 128 MB.");
    return await readFile(path);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return undefined;
    throw error;
  }
}

export interface DatabaseSnapshot {
  readonly name: string;
  readonly createdAt: number;
  readonly kind: string;
}

function loadSqlite(): Promise<SqlJsStatic> {
  sqliteRuntime ??= initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
  });
  return sqliteRuntime;
}

export class DatabaseInitializationError extends Error {
  public constructor() {
    super("DevDashboardV1 could not initialize its local database.");
    this.name = "DatabaseInitializationError";
  }
}

export class LocalDatabase {
  // ponytail: writes are serialized within one host; close other VS Code windows before restore.
  private writes: Promise<void> = Promise.resolve();
  private restoring = false;
  private lastAutomaticSnapshot = 0;
  private constructor(
    private readonly filePath: string,
    private readonly database: Database,
  ) {}

  public static async open(filePath: string): Promise<LocalDatabase> {
    let localDatabase: LocalDatabase | undefined;
    try {
      const SQL = await loadSqlite();
      const bytes = await readDatabaseFile(filePath);
      localDatabase = new LocalDatabase(
        filePath,
        bytes === undefined ? new SQL.Database() : await this.validate(bytes),
      );
      localDatabase.database.run("PRAGMA foreign_keys = ON;");
      const snapshots = await this.listSnapshots(filePath);
      localDatabase.lastAutomaticSnapshot =
        snapshots.find((snapshot) => snapshot.kind === "automatic")
          ?.createdAt ?? 0;
      if (
        bytes &&
        Number(
          localDatabase.getScalar(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations;",
          ),
        ) < migrations.length
      )
        await this.saveSnapshot(filePath, bytes, "migration");
      await localDatabase.applyMigrations();
      return localDatabase;
    } catch {
      localDatabase?.close();
      throw new DatabaseInitializationError();
    }
  }

  public run(sql: string, parameters: readonly SqlParameter[] = []): void {
    this.ensureWritable();
    this.database.run(sql, [...parameters]);
  }

  public getScalar(
    sql: string,
    parameters: readonly SqlParameter[] = [],
  ): unknown {
    this.ensureWritable();
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
    this.ensureWritable();
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
    this.ensureWritable();
    const bytes = this.database.export();
    this.database.run("PRAGMA foreign_keys = ON;");
    if (bytes.byteLength > MAX_DATABASE_BYTES)
      throw new Error("Database exceeds the supported size limit.");
    await this.enqueue(async () => {
      const previous = await readDatabaseFile(this.filePath);
      if (
        previous &&
        Date.now() - this.lastAutomaticSnapshot >= 3_600_000 &&
        digest(previous) !== digest(bytes)
      ) {
        await LocalDatabase.saveSnapshot(this.filePath, previous, "automatic");
        this.lastAutomaticSnapshot = Date.now();
      }
      await atomicWrite(this.filePath, bytes);
    });
  }

  public async createSnapshot(): Promise<string> {
    this.ensureWritable();
    const bytes = this.database.export();
    this.database.run("PRAGMA foreign_keys = ON;");
    return this.enqueue(() =>
      LocalDatabase.saveSnapshot(this.filePath, bytes, "manual"),
    );
  }

  public snapshots(): Promise<readonly DatabaseSnapshot[]> {
    return LocalDatabase.listSnapshots(this.filePath);
  }

  public async restoreSnapshot(name: string): Promise<void> {
    this.ensureWritable();
    this.restoring = true;
    try {
      await this.enqueue(() => LocalDatabase.restoreFile(this.filePath, name));
    } catch (error) {
      this.restoring = false;
      throw error;
    }
    // Existing repositories must never write old in-memory data after replacement.
  }

  public static async listSnapshots(
    filePath: string,
  ): Promise<readonly DatabaseSnapshot[]> {
    const directory = join(dirname(filePath), "snapshots");
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Invalid snapshot directory.");
      const snapshots: DatabaseSnapshot[] = [];
      for (const name of await readdir(directory)) {
        if (!SNAPSHOT_NAME.test(name)) continue;
        const info = await lstat(join(directory, name));
        if (info.isFile() && !info.isSymbolicLink())
          snapshots.push({
            name,
            createdAt: Number(name.split("-")[1]),
            kind:
              name.split("-")[2] === "before"
                ? "before-restore"
                : name.split("-")[2]!,
          });
      }
      return snapshots.sort(
        (a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name),
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return [];
      throw error;
    }
  }

  public static async restoreFile(
    filePath: string,
    name: string,
  ): Promise<void> {
    if (!SNAPSHOT_NAME.test(name))
      throw new Error("Invalid snapshot selection.");
    const available = await this.listSnapshots(filePath);
    if (!available.some((snapshot) => snapshot.name === name))
      throw new Error("Snapshot not found.");
    const path = join(dirname(filePath), "snapshots", name);
    const bytes = await readDatabaseFile(path);
    const checksumInfo = await lstat(`${path}.sha256`);
    if (
      !checksumInfo.isFile() ||
      checksumInfo.isSymbolicLink() ||
      checksumInfo.size !== 64
    )
      throw new Error("Invalid snapshot checksum file.");
    const checksum = await readFile(`${path}.sha256`, "utf8");
    if (
      !bytes ||
      !/^[a-f0-9]{64}$/u.test(checksum) ||
      digest(bytes) !== checksum
    )
      throw new Error("Snapshot checksum failed.");
    const database = await this.validate(bytes);
    try {
      const candidate = new LocalDatabase(filePath, database);
      database.run("PRAGMA foreign_keys = ON;");
      await candidate.applyMigrations(false);
      const restored = database.export();
      const previous = await readDatabaseFile(filePath);
      if (previous)
        await this.saveSnapshot(filePath, previous, "before-restore");
      await atomicWrite(filePath, restored);
    } finally {
      database.close();
    }
  }

  private ensureWritable(): void {
    if (this.restoring)
      throw new Error(
        "Database restore is in progress or complete. Reload VS Code before making changes.",
      );
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(operation);
    this.writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private static async saveSnapshot(
    filePath: string,
    bytes: Uint8Array,
    kind: "automatic" | "manual" | "migration" | "before-restore",
  ): Promise<string> {
    if (bytes.byteLength > MAX_DATABASE_BYTES)
      throw new Error("Database exceeds the snapshot size limit.");
    const directory = join(dirname(filePath), "snapshots");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await this.listSnapshots(filePath); // Reject redirected/symlinked snapshot directories.
    const name = `snapshot-${Date.now()}-${kind}-${randomUUID()}.sqlite`;
    await atomicWrite(join(directory, name), bytes);
    await atomicWrite(
      join(directory, `${name}.sha256`),
      Buffer.from(digest(bytes)),
    );
    const snapshots = await this.listSnapshots(filePath);
    for (const snapshot of snapshots
      .filter((snapshot) => snapshot.name !== name)
      .slice(SNAPSHOT_LIMIT - 1)) {
      await unlink(join(directory, snapshot.name));
      await unlink(join(directory, `${snapshot.name}.sha256`)).catch(
        (error: unknown) => {
          if (!(
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
          ))
            throw error;
        },
      );
    }
    return name;
  }

  private static async validate(bytes: Uint8Array): Promise<Database> {
    if (
      bytes.byteLength > MAX_DATABASE_BYTES ||
      Buffer.from(bytes.subarray(0, 16)).toString("ascii") !==
        "SQLite format 3\0"
    )
      throw new Error("Invalid SQLite snapshot.");
    const SQL = await loadSqlite();
    const database = new SQL.Database(bytes);
    const reference = new SQL.Database();
    try {
      if (
        JSON.stringify(database.exec("PRAGMA integrity_check;")[0]?.values) !==
          '[["ok"]]' ||
        database.exec("PRAGMA foreign_key_check;").length
      )
        throw new Error("Database integrity check failed.");
      const history =
        database.exec(
          "SELECT version, name FROM schema_migrations ORDER BY version;",
        )[0]?.values ?? [];
      if (
        history.length > migrations.length ||
        history.some(
          (row, index) =>
            row[0] !== migrations[index]?.version ||
            row[1] !== migrations[index]?.name,
        )
      )
        throw new Error("Unsupported database schema version.");
      reference.run(MIGRATION_TABLE);
      for (const migration of migrations.slice(0, history.length))
        reference.run(migration.sql);
      const schema =
        "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name;";
      const normalized = (db: Database) =>
        db
          .exec(schema)[0]
          ?.values.map((row) =>
            row.map((value) =>
              typeof value === "string"
                ? value.replace(/\s+/gu, " ").trim()
                : value,
            ),
          );
      if (
        JSON.stringify(normalized(database)) !==
        JSON.stringify(normalized(reference))
      )
        throw new Error("Database schema is incompatible.");
      return database;
    } catch (error) {
      database.close();
      throw error;
    } finally {
      reference.close();
    }
  }

  public close(): void {
    this.database.close();
  }

  private async applyMigrations(persist = true): Promise<void> {
    this.database.run(MIGRATION_TABLE);
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
    if (persist) await this.persist();
  }
}
