import process from "node:process";

const [expectedPlatform, expectedArchitecture] = process.argv.slice(2);

if (!expectedPlatform || !expectedArchitecture) {
  throw new Error(
    "Usage: node scripts/verify-release-target.mjs <platform> <architecture>",
  );
}

if (
  process.platform !== expectedPlatform ||
  process.arch !== expectedArchitecture
) {
  throw new Error(
    `Expected ${expectedPlatform}/${expectedArchitecture}, received ${process.platform}/${process.arch}.`,
  );
}

process.stdout.write(
  `Validated release runner ${process.platform}/${process.arch}.\n`,
);
