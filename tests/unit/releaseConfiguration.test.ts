import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  readonly scripts: Readonly<Record<string, string>>;
  readonly version: string;
};

void describe("Release validation configuration", () => {
  void it("pins all supported operating-system and architecture targets", () => {
    for (const target of [
      ["windows-2025", "win32", "x64"],
      ["macos-15-intel", "darwin", "x64"],
      ["macos-15", "darwin", "arm64"],
      ["ubuntu-24.04", "linux", "x64"],
    ]) {
      for (const value of target)
        assert.match(workflow, new RegExp(value, "u"));
    }
    assert.doesNotMatch(workflow, /(?:windows|macos|ubuntu)-latest/u);
  });

  void it("verifies the runner, validates, packages, and retains each VSIX", () => {
    assert.match(workflow, /scripts\/verify-release-target\.mjs/u);
    assert.match(workflow, /run: npm run validate/u);
    assert.match(workflow, /actions\/upload-artifact@v4/u);
    assert.match(workflow, /path: devdashboardv1\.vsix/u);
  });

  void it("identifies a Marketplace-compatible release and verifies the packaged archive", () => {
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/u);
    assert.equal(manifest.version, "0.1.0");
    assert.match(manifest.scripts.validate ?? "", /npm run verify:vsix/u);
    assert.match(
      manifest.scripts["verify:vsix"] ?? "",
      /scripts\/verify-vsix\.mjs/u,
    );
  });
});
