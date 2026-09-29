import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

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
    assert.match(workflow, /path: devworkspace\.vsix/u);
  });
});
