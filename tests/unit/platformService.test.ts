import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPlatformService } from "../../src/platform/platformService";

void describe("Platform service", () => {
  void it("maps Windows behavior", () => {
    assert.deepEqual(createPlatformService("win32"), {
      operatingSystem: "windows",
      pathSeparator: "\\",
      defaultShell: "powershell.exe",
    });
  });
  void it("maps macOS behavior", () => {
    assert.deepEqual(createPlatformService("darwin"), {
      operatingSystem: "macos",
      pathSeparator: "/",
      defaultShell: "/bin/zsh",
    });
  });
  void it("maps Linux behavior", () => {
    assert.deepEqual(createPlatformService("linux"), {
      operatingSystem: "linux",
      pathSeparator: "/",
      defaultShell: "/bin/sh",
    });
  });
});
