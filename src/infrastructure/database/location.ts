import { join, resolve } from "node:path";

const DATABASE_FILE_NAME = "devworkspace.sqlite";

export function getDatabasePath(globalStoragePath: string): string {
  if (globalStoragePath.trim().length === 0) {
    throw new Error("A global storage path is required.");
  }
  return resolve(join(globalStoragePath, DATABASE_FILE_NAME));
}
