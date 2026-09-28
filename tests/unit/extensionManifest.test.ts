import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

interface ExtensionManifest {
  readonly activationEvents?: readonly string[];
  readonly contributes?: {
    readonly commands?: ReadonlyArray<{
      readonly command?: string;
      readonly title?: string;
    }>;
  };
  readonly main?: string;
}

function readManifest(): ExtensionManifest {
  const manifestPath = resolve(__dirname, "../../../package.json");
  return JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
}

void describe("Extension manifest", () => {
  void it("registers the DevWorkspace open command", () => {
    const manifest = readManifest();

    assert.equal(manifest.main, "./dist/src/extension/extension.js");
    assert.ok(
      manifest.activationEvents?.includes("onCommand:devworkspace.open"),
    );
    assert.ok(
      manifest.contributes?.commands?.some(
        ({ command, title }) =>
          command === "devworkspace.open" && title === "Open DevWorkspace",
      ),
    );
  });
});
