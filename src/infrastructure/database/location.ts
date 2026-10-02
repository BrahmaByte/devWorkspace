import { constants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const STABLE_STORAGE_DIRECTORY = "brahmabyte.localdata";
const DATABASE_FILE_NAME = "workspace.sqlite";
const LEGACY_DATABASE_FILE_NAME = "devworkspace.sqlite";
const LEGACY_EXTENSION_DIRECTORIES = [
  "brahmabyte.devdashboardv1",
  "devworkspace.devworkspace",
] as const;

export function getDatabasePath(globalStoragePath: string): string {
  if (globalStoragePath.trim().length === 0) {
    throw new Error("A global storage path is required.");
  }
  return resolve(join(globalStoragePath, DATABASE_FILE_NAME));
}

export async function prepareDatabasePath(
  globalStoragePath: string,
): Promise<string> {
  if (globalStoragePath.trim().length === 0) {
    throw new Error("A global storage path is required.");
  }
  const databasePath = getDatabasePath(
    join(dirname(globalStoragePath), STABLE_STORAGE_DIRECTORY),
  );
  await mkdir(dirname(databasePath), { recursive: true });
  if (await exists(databasePath)) return databasePath;

  for (const candidate of legacyDatabasePaths(globalStoragePath)) {
    if (!(await exists(candidate))) continue;
    await copyFile(candidate, databasePath);
    break;
  }
  return databasePath;
}

export function legacyDatabasePaths(
  globalStoragePath: string,
): readonly string[] {
  if (globalStoragePath.trim().length === 0) {
    throw new Error("A global storage path is required.");
  }
  const globalStorageRoot = dirname(globalStoragePath);
  return [
    resolve(join(globalStoragePath, LEGACY_DATABASE_FILE_NAME)),
    ...LEGACY_EXTENSION_DIRECTORIES.map((directory) =>
      resolve(join(globalStorageRoot, directory, LEGACY_DATABASE_FILE_NAME)),
    ),
  ].filter((candidate, index, all) => all.indexOf(candidate) === index);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
