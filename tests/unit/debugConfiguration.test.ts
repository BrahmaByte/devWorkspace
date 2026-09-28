import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

interface DebugConfiguration {
  readonly configurations?: ReadonlyArray<{
    readonly request?: string;
    readonly runtimeExecutable?: string;
    readonly stopOnEntry?: boolean;
    readonly type?: string;
  }>;
}

void describe("Extension debug configuration", () => {
  void it("launches the current VS Code executable without stopping on entry", () => {
    const launchPath = resolve(__dirname, "../../../.vscode/launch.json");
    const launch = JSON.parse(
      readFileSync(launchPath, "utf8"),
    ) as DebugConfiguration;
    const configuration = launch.configurations?.[0];

    assert.equal(configuration?.type, "extensionHost");
    assert.equal(configuration?.request, "launch");
    assert.equal(configuration?.runtimeExecutable, "${execPath}");
    assert.equal(configuration?.stopOnEntry, false);
  });
});
