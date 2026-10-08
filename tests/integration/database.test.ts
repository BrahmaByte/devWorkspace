import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import initSqlJs from "sql.js";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";

import {
  getDatabasePath,
  prepareDatabasePath,
} from "../../src/infrastructure/database/location";
import {
  DatabaseInitializationError,
  LocalDatabase,
} from "../../src/infrastructure/database/localDatabase";
import { LocalStateRepository } from "../../src/infrastructure/database/localStateRepository";

const temporaryDirectories: string[] = [];

async function rewriteDatabase(filePath: string, sql: string): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
  });
  const database = new SQL.Database(await readFile(filePath));
  database.run(sql);
  const bytes = database.export();
  database.close();
  await writeFile(filePath, bytes);
}

async function createDatabase(): Promise<{
  database: LocalDatabase;
  filePath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "devworkspace-db-"));
  temporaryDirectories.push(directory);
  const filePath = getDatabasePath(directory);
  return { database: await LocalDatabase.open(filePath), filePath };
}

void afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

void describe("Local SQLite database", () => {
  void it("restores a manual snapshot, backs up replaced data and blocks stale writes", async () => {
    const { database, filePath } = await createDatabase();
    const repository = new LocalStateRepository(database);
    await repository.createNote({
      id: "a",
      title: "First",
      content: "Original",
    });
    const snapshot = await database.createSnapshot();
    await repository.createNote({ id: "b", title: "Second", content: "Later" });
    await database.restoreSnapshot(snapshot);
    assert.throws(() => database.run("DELETE FROM notes;"), /Reload VS Code/u);
    await assert.rejects(database.persist(), /Reload VS Code/u);
    database.close();
    const restored = await LocalDatabase.open(filePath);
    assert.equal(new LocalStateRepository(restored).count("notes"), 1);
    assert.equal(
      restored.getScalar("SELECT content FROM notes WHERE id = 'a';"),
      "Original",
    );
    const backup = (await restored.snapshots()).find(
      ({ kind }) => kind === "before-restore",
    );
    assert.ok(backup);
    await restored.restoreSnapshot(backup.name);
    restored.close();
    const previous = await LocalDatabase.open(filePath);
    assert.equal(new LocalStateRepository(previous).count("notes"), 2);
    previous.close();
  });

  void it("snapshots the previous file before a changed save and limits automatic frequency", async () => {
    const { database, filePath } = await createDatabase();
    const before = await readFile(filePath);
    const repository = new LocalStateRepository(database);
    await repository.createNote({
      id: "a",
      title: "First",
      content: "Original",
    });
    await repository.createNote({ id: "b", title: "Second", content: "Later" });
    const automatic = (await database.snapshots()).filter(
      ({ kind }) => kind === "automatic",
    );
    assert.equal(automatic.length, 1);
    assert.deepEqual(
      await readFile(join(dirname(filePath), "snapshots", automatic[0]!.name)),
      before,
    );
    database.close();
  });

  void it("serializes concurrent saves without leaving temporary files", async () => {
    const { database, filePath } = await createDatabase();
    const repository = new LocalStateRepository(database);
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        repository.createNote({
          id: String(index),
          title: "Note",
          content: "Local data",
        }),
      ),
    );
    assert.ok(
      !(await readdir(dirname(filePath))).some((name) => name.endsWith(".tmp")),
    );
    database.close();
    const reopened = await LocalDatabase.open(filePath);
    assert.equal(new LocalStateRepository(reopened).count("notes"), 8);
    reopened.close();
  });

  void it("keeps the live file unchanged when a required snapshot cannot be written", async () => {
    const { database, filePath } = await createDatabase();
    const before = await readFile(filePath);
    // A regular file where the snapshot directory belongs simulates unavailable storage.
    const blocked = join(dirname(filePath), "snapshots");
    await writeFile(blocked, "unavailable");
    database.run(
      "UPDATE jira_board_preferences SET jql_filter = 'project = FAKE' WHERE id = 1;",
    );
    await assert.rejects(database.persist());
    assert.deepEqual(await readFile(filePath), before);
    await rm(blocked);
    await database.persist();
    database.close();
    const reopened = await LocalDatabase.open(filePath);
    assert.equal(
      reopened.getScalar(
        "SELECT jql_filter FROM jira_board_preferences WHERE id = 1;",
      ),
      "project = FAKE",
    );
    reopened.close();
  });

  void it("retains ten snapshots with matching checksums including the newest manual copy", async () => {
    const { database, filePath } = await createDatabase();
    let newest = "";
    for (let index = 0; index < 12; index++)
      newest = await database.createSnapshot();
    const snapshots = await database.snapshots();
    assert.equal(snapshots.length, 10);
    assert.ok(snapshots.some(({ name }) => name === newest));
    const files = await readdir(join(dirname(filePath), "snapshots"));
    assert.equal(files.length, 20);
    for (const { name } of snapshots) {
      const path = join(dirname(filePath), "snapshots", name);
      assert.equal(
        await readFile(`${path}.sha256`, "utf8"),
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      );
    }
    database.close();
  });

  void it("rejects corruption, unsupported schemas and path traversal without replacing data", async () => {
    const { database, filePath } = await createDatabase();
    const snapshot = await database.createSnapshot();
    const path = join(dirname(filePath), "snapshots", snapshot);
    const good = await readFile(path);
    const live = await readFile(filePath);
    await writeFile(path, "corrupt");
    await assert.rejects(database.restoreSnapshot(snapshot), /checksum/u);
    assert.deepEqual(await readFile(filePath), live);
    for (const sql of [
      "INSERT INTO schema_migrations VALUES (9, 'future', '2026');",
      "CREATE TRIGGER unexpected AFTER INSERT ON notes BEGIN DELETE FROM notes; END;",
      "PRAGMA foreign_keys = OFF; INSERT INTO environment_profiles (id, project_id, name) VALUES ('bad', 'missing', 'Fake');",
    ]) {
      await writeFile(path, good);
      await rewriteDatabase(path, sql);
      const bytes = await readFile(path);
      await writeFile(
        `${path}.sha256`,
        createHash("sha256").update(bytes).digest("hex"),
      );
      await assert.rejects(database.restoreSnapshot(snapshot));
      assert.deepEqual(await readFile(filePath), live);
    }
    await assert.rejects(
      database.restoreSnapshot("../../workspace.sqlite"),
      /selection/u,
    );
    await database.persist(); // A failed restore does not poison subsequent writes.
    database.close();
  });

  void it("recovers a corrupt live file from a validated snapshot without discarding the damaged copy", async () => {
    const { database, filePath } = await createDatabase();
    await new LocalStateRepository(database).createNote({
      id: "a",
      title: "Saved",
      content: "Local",
    });
    const snapshot = await database.createSnapshot();
    database.close();
    await writeFile(filePath, "damaged database");
    await assert.rejects(
      LocalDatabase.open(filePath),
      DatabaseInitializationError,
    );
    assert.equal(await readFile(filePath, "utf8"), "damaged database");
    await LocalDatabase.restoreFile(filePath, snapshot);
    const restored = await LocalDatabase.open(filePath);
    assert.equal(new LocalStateRepository(restored).count("notes"), 1);
    const backup = (await restored.snapshots()).find(
      ({ kind }) => kind === "before-restore",
    );
    assert.ok(backup);
    assert.equal(
      await readFile(join(dirname(filePath), "snapshots", backup.name), "utf8"),
      "damaged database",
    );
    restored.close();
  });

  void it("takes a pre-migration snapshot and migrates supported older restores in memory", async () => {
    const { database, filePath } = await createDatabase();
    database.close();
    await rewriteDatabase(
      filePath,
      "DROP TABLE calendar_entries; DROP TABLE calendar_leave_types; DELETE FROM schema_migrations WHERE version IN (7,8); DROP TABLE developer_applications; DELETE FROM schema_migrations WHERE version = 6;",
    );
    const oldBytes = await readFile(filePath);
    const migrated = await LocalDatabase.open(filePath);
    const snapshot = (await migrated.snapshots()).find(
      ({ kind }) => kind === "migration",
    );
    assert.ok(snapshot);
    assert.deepEqual(
      await readFile(join(dirname(filePath), "snapshots", snapshot.name)),
      oldBytes,
    );
    await migrated.restoreSnapshot(snapshot.name);
    migrated.close();
    const restored = await LocalDatabase.open(filePath);
    assert.equal(new LocalStateRepository(restored).getSchemaVersion(), 8);
    restored.close();
  });

  void it("uses a generic filename and migrates legacy extension storage", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "devdashboard-storage-"));
    temporaryDirectories.push(storageRoot);
    const extensionStorage = join(storageRoot, "brahmabyte.devdashboardv1");
    await mkdir(extensionStorage, { recursive: true });
    await writeFile(join(extensionStorage, "devworkspace.sqlite"), "legacy");

    const databasePath = await prepareDatabasePath(extensionStorage);

    assert.equal(
      databasePath,
      join(storageRoot, "brahmabyte.localdata", "workspace.sqlite"),
    );
    assert.equal(await readFile(databasePath, "utf8"), "legacy");
    assert.equal(
      getDatabasePath(extensionStorage).endsWith("workspace.sqlite"),
      true,
    );
  });

  void it("never overwrites an existing stable database during migration", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "devdashboard-storage-"));
    temporaryDirectories.push(storageRoot);
    const extensionStorage = join(storageRoot, "renamed.extension");
    const stableStorage = join(storageRoot, "brahmabyte.localdata");
    await mkdir(extensionStorage, { recursive: true });
    await mkdir(stableStorage, { recursive: true });
    await writeFile(join(extensionStorage, "devworkspace.sqlite"), "legacy");
    await writeFile(join(stableStorage, "workspace.sqlite"), "current");

    const databasePath = await prepareDatabasePath(extensionStorage);

    assert.equal(await readFile(databasePath, "utf8"), "current");
  });

  void it("initializes every Milestone 2 table and records migrations", async () => {
    const { database } = await createDatabase();
    const repository = new LocalStateRepository(database);

    assert.equal(repository.getSchemaVersion(), 8);
    assert.equal(
      database.getScalar(
        "SELECT name FROM schema_migrations WHERE version = 1;",
      ),
      "initial_schema",
    );
    assert.deepEqual(database.getTableNames(), [
      "calendar_entries",
      "calendar_leave_types",
      "confluence_connections",
      "confluence_page_cache",
      "developer_applications",
      "environment_profiles",
      "favourites",
      "jira_board_preferences",
      "jira_connections",
      "jira_issue_cache",
      "jira_local_cards",
      "notes",
      "project_commands",
      "projects",
      "recent_resources",
      "relationships",
      "schema_migrations",
      "sticky_notes",
      "url_groups",
    ]);
    for (const table of [
      "jira_connections",
      "confluence_connections",
    ] as const) {
      assert.equal(
        database
          .getConnectionColumnNames(table)
          .some((name) => /token|pat|secret|credential/i.test(name)),
        false,
      );
    }
    database.close();
  });

  void it("persists repository data across restart without rerunning migrations", async () => {
    const { database, filePath } = await createDatabase();
    await new LocalStateRepository(database).createProject({
      id: "project-1",
      name: "DevWorkspace",
      localPath: "/safe/fake/project",
    });
    database.close();

    const reopened = await LocalDatabase.open(filePath);
    const repository = new LocalStateRepository(reopened);
    assert.equal(repository.getSchemaVersion(), 8);
    assert.equal(repository.count("projects"), 1);
    assert.equal(
      reopened.getScalar("SELECT COUNT(*) FROM schema_migrations;"),
      8,
    );
    reopened.close();
  });

  void it("enforces uniqueness, checks, and foreign keys", async () => {
    const { database } = await createDatabase();
    const repository = new LocalStateRepository(database);
    await repository.createProject({
      id: "project-1",
      name: "One",
      localPath: "/same/path",
    });
    await assert.rejects(
      repository.createProject({
        id: "project-2",
        name: "Two",
        localPath: "/same/path",
      }),
    );
    assert.equal(database.getScalar("PRAGMA foreign_keys;"), 1);
    assert.throws(() =>
      database.run(
        "INSERT INTO project_commands(id, project_id, name, command, platform, shell, confirmation_policy) VALUES (?, ?, ?, ?, ?, ?, ?);",
        ["command-1", "missing", "Build", "npm test", "any", "sh", "always"],
      ),
    );
    assert.throws(() =>
      database.run(
        "INSERT INTO project_commands(id, project_id, name, command, platform, shell, confirmation_policy) VALUES (?, ?, ?, ?, ?, ?, ?);",
        [
          "command-2",
          "project-1",
          "Build",
          "npm test",
          "other",
          "sh",
          "always",
        ],
      ),
    );
    database.close();
  });

  void it("persists normalized relationships and rejects duplicates", async () => {
    const { database } = await createDatabase();
    const repository = new LocalStateRepository(database);
    await repository.createNote({ id: "note-1", title: "Work", content: "" });
    await repository.createProject({
      id: "project-1",
      name: "Project",
      localPath: "/fake/project",
    });
    await repository.createRelationship(
      "relationship-1",
      "note",
      "note-1",
      "project",
      "project-1",
    );
    assert.equal(repository.count("relationships"), 1);
    await assert.rejects(
      repository.createRelationship(
        "relationship-2",
        "note",
        "note-1",
        "project",
        "project-1",
      ),
    );
    database.close();
  });

  void it("maps corrupt database files to a safe initialization error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devworkspace-corrupt-"));
    temporaryDirectories.push(directory);
    const filePath = getDatabasePath(directory);
    await writeFile(filePath, "not a sqlite database");

    await assert.rejects(
      LocalDatabase.open(filePath),
      DatabaseInitializationError,
    );
  });
});
