import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";

const tag = process.argv[2];
assert.match(
  tag ?? "",
  /^v\d+\.\d+\.\d+$/u,
  "Use a stable vMAJOR.MINOR.PATCH tag",
);
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
assert.equal(
  tag,
  `v${manifest.version}`,
  "Release tag must match package version",
);
assert.equal(lock.version, manifest.version, "Lockfile version must match");
assert.equal(
  lock.packages[""].version,
  manifest.version,
  "Root lock version must match",
);
assert.equal(manifest.publisher, "BrahmaByte");
assert.equal(manifest.name, "devdashboardv1");
const notes = readFileSync(`releases/${manifest.version}.txt`, "utf8");
assert.ok(notes.trim().length > 50, "Release notes are required");
process.stdout.write(
  `Verified ${manifest.publisher}.${manifest.name} ${tag}\n`,
);
