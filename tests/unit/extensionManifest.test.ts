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
    readonly keybindings?: ReadonlyArray<{
      readonly command?: string;
      readonly key?: string;
      readonly mac?: string;
    }>;
  };
  readonly main?: string;
}

function readManifest(): ExtensionManifest {
  const manifestPath = resolve(__dirname, "../../../package.json");
  return JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
}

void describe("Extension manifest", () => {
  void it("registers the DevDashboard open command", () => {
    const manifest = readManifest();

    assert.equal(manifest.main, "./dist/src/extension/extension.js");
    assert.ok(
      manifest.activationEvents?.includes("onCommand:devdashboard.open"),
    );
    assert.ok(
      manifest.contributes?.commands?.some(
        ({ command, title }) =>
          command === "devdashboard.open" && title === "Open DevDashboard",
      ),
    );
  });
  void it("registers the global search command and shortcut", () => {
    const manifest = readManifest();
    assert.ok(
      manifest.activationEvents?.includes("onCommand:devdashboard.search"),
    );
    assert.ok(
      manifest.contributes?.commands?.some(
        ({ command }) => command === "devdashboard.search",
      ),
    );
    assert.ok(
      manifest.contributes?.keybindings?.some(
        ({ command, key, mac }) =>
          command === "devdashboard.search" &&
          key === "ctrl+alt+k" &&
          mac === "cmd+alt+k",
      ),
    );
  });
});
