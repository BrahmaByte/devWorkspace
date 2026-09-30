import { readFileSync } from "node:fs";
import process from "node:process";
import { inflateRawSync } from "node:zlib";

const archivePath = process.argv[2];
if (!archivePath)
  throw new Error("Usage: node scripts/verify-vsix.mjs <archive.vsix>");

const archive = readFileSync(archivePath);
const signatures = {
  central: 0x02014b50,
  end: 0x06054b50,
  local: 0x04034b50,
};
let endOffset = -1;
for (let index = archive.length - 22; index >= 0; index -= 1) {
  if (archive.readUInt32LE(index) === signatures.end) {
    endOffset = index;
    break;
  }
}
if (endOffset < 0) throw new Error("VSIX central directory was not found.");

const entryCount = archive.readUInt16LE(endOffset + 10);
let offset = archive.readUInt32LE(endOffset + 16);
const entries = new Map();
for (let index = 0; index < entryCount; index += 1) {
  if (archive.readUInt32LE(offset) !== signatures.central)
    throw new Error("VSIX central directory is malformed.");
  const method = archive.readUInt16LE(offset + 10);
  const compressedSize = archive.readUInt32LE(offset + 20);
  const uncompressedSize = archive.readUInt32LE(offset + 24);
  const nameLength = archive.readUInt16LE(offset + 28);
  const extraLength = archive.readUInt16LE(offset + 30);
  const commentLength = archive.readUInt16LE(offset + 32);
  const localOffset = archive.readUInt32LE(offset + 42);
  const name = archive
    .subarray(offset + 46, offset + 46 + nameLength)
    .toString("utf8");
  entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
  offset += 46 + nameLength + extraLength + commentLength;
}

const required = [
  "extension.vsixmanifest",
  "extension/LICENSE.txt",
  "extension/package.json",
  "extension/readme.md",
  "extension/dist/src/extension/extension.js",
  "extension/node_modules/sql.js/dist/sql-wasm.js",
  "extension/node_modules/sql.js/dist/sql-wasm.wasm",
];
for (const name of required)
  if (!entries.has(name)) throw new Error(`VSIX is missing ${name}.`);

const forbidden = [...entries.keys()].filter(
  (name) =>
    /^extension\/(?:tests?|docs?|scripts?|src)\//u.test(name) ||
    /\.(?:map|ts|sqlite|db|env)$/u.test(name) ||
    (/\.md$/iu.test(name) && name !== "extension/readme.md"),
);
if (forbidden.length)
  throw new Error(
    `VSIX contains release-excluded files: ${forbidden.join(", ")}`,
  );

const readEntry = (name) => {
  const entry = entries.get(name);
  if (!entry) throw new Error(`VSIX entry ${name} was not found.`);
  const local = entry.localOffset;
  if (archive.readUInt32LE(local) !== signatures.local)
    throw new Error(`VSIX entry ${name} has an invalid local header.`);
  const nameLength = archive.readUInt16LE(local + 26);
  const extraLength = archive.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const compressed = archive.subarray(start, start + entry.compressedSize);
  const contents =
    entry.method === 0
      ? compressed
      : entry.method === 8
        ? inflateRawSync(compressed)
        : undefined;
  if (!contents || contents.length !== entry.uncompressedSize)
    throw new Error(`VSIX entry ${name} could not be verified.`);
  return contents;
};

const packagedManifest = JSON.parse(
  readEntry("extension/package.json").toString("utf8"),
);
const sourceManifest = JSON.parse(readFileSync("package.json", "utf8"));
if (packagedManifest.version !== sourceManifest.version)
  throw new Error("VSIX version does not match package.json.");
const vsixManifest = readEntry("extension.vsixmanifest").toString("utf8");
if (!vsixManifest.includes(`Version="${sourceManifest.version}"`))
  throw new Error("VSIX manifest does not contain the release version.");

process.stdout.write(
  `Verified ${archivePath}: ${entries.size} files, version ${sourceManifest.version}.\n`,
);
