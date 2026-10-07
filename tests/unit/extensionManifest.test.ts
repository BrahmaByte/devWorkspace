import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

interface ExtensionManifest {
  readonly activationEvents?: readonly string[];
  readonly icon?: string;
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
  readonly extensionKind?: readonly string[];
}

function readManifest(): ExtensionManifest {
  const manifestPath = resolve(__dirname, "../../../package.json");
  return JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
}

void describe("Extension manifest", () => {
  void it("provides native database snapshot and restore commands", () => {
    const manifest = readManifest();
    for (const suffix of ["snapshot", "restore"]) {
      const command = `devdashboardv1.database.${suffix}`;
      assert.ok(manifest.activationEvents?.includes(`onCommand:${command}`));
      assert.ok(
        manifest.contributes?.commands?.some(
          (entry) => entry.command === command,
        ),
      );
    }
  });
  void it("activates onboarding after startup and provides a replay command", () => {
    const manifest = readManifest();
    assert.ok(manifest.activationEvents?.includes("onStartupFinished"));
    assert.ok(
      manifest.contributes?.commands?.some(
        ({ command }) => command === "devdashboardv1.guide",
      ),
    );
  });
  void it("uses the packaged DevDashboardV1 Marketplace icon", () => {
    assert.equal(readManifest().icon, "assets/devdashboardv1-icon.png");
  });

  void it("registers the DevDashboardV1 open command", () => {
    const manifest = readManifest();

    assert.equal(manifest.main, "./dist/src/extension/extension.js");
    assert.ok(
      manifest.activationEvents?.includes("onCommand:devdashboardv1.open"),
    );
    assert.ok(
      manifest.contributes?.commands?.some(
        ({ command, title }) =>
          command === "devdashboardv1.open" && title === "Open DevDashboardV1",
      ),
    );
  });

  void it("runs on the local UI host for desktop application control", () => {
    assert.deepEqual(readManifest().extensionKind, ["ui"]);
  });
  void it("registers the global search command and shortcut", () => {
    const manifest = readManifest();
    assert.ok(
      manifest.activationEvents?.includes("onCommand:devdashboardv1.search"),
    );
    assert.ok(
      manifest.contributes?.commands?.some(
        ({ command }) => command === "devdashboardv1.search",
      ),
    );
    assert.ok(
      manifest.contributes?.keybindings?.some(
        ({ command, key, mac }) =>
          command === "devdashboardv1.search" &&
          key === "ctrl+alt+k" &&
          mac === "cmd+alt+k",
      ),
    );
  });
});
