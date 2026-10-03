import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DeveloperApplicationIconProvider,
  pngIconData,
} from "../../src/platform/developerApplicationIcon";

void describe("developer application icons", () => {
  void it("accepts bounded PNG data and rejects active or oversized content", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
      "base64",
    );
    assert.equal(
      pngIconData(png),
      `data:image/png;base64,${png.toString("base64")}`,
    );
    assert.equal(
      pngIconData(Buffer.from('<svg onload="alert(1)"/>')),
      undefined,
    );
    assert.equal(
      pngIconData(Buffer.concat([png, Buffer.alloc(512 * 1024)])),
      undefined,
    );
  });

  void it("returns a cached fallback for an app without readable icon metadata", async () => {
    const provider = new DeveloperApplicationIconProvider("macos");
    const first = provider.getIcon("/missing/Developer Tool.app");
    assert.equal(provider.getIcon("/missing/Developer Tool.app"), first);
    assert.equal(await first, undefined);
  });
});
