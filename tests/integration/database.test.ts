import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

    assert.equal(repository.getSchemaVersion(), 6);
    assert.equal(
      database.getScalar(
        "SELECT name FROM schema_migrations WHERE version = 1;",
      ),
      "initial_schema",
    );
    assert.deepEqual(database.getTableNames(), [
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
    assert.equal(repository.getSchemaVersion(), 6);
    assert.equal(repository.count("projects"), 1);
    assert.equal(
      reopened.getScalar("SELECT COUNT(*) FROM schema_migrations;"),
      6,
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
