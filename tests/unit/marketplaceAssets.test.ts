import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

void describe("Marketplace documentation assets", () => {
  void it("uses a public Marketplace logo and packaged PNG screenshots", () => {
    const root = resolve(__dirname, "../../..");
    const readme = readFileSync(resolve(root, "README.md"), "utf8");
    assert.match(
      readme,
      /https:\/\/BrahmaByte\.gallery\.vsassets\.io\/[^"\s]+\/assetbyname\/Microsoft\.VisualStudio\.Services\.Icons\.Default/u,
    );
    const screenshots = [
      ...readme.matchAll(/!\[[^\]]*\]\((assets\/screenshots\/[^)]+)\)/gu),
    ];
    assert.equal(screenshots.length, 6);
    for (const match of screenshots) {
      const bytes = readFileSync(resolve(root, match[1]!));
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    }
    assert.doesNotMatch(readme, /\]\([^)]*\.md(?:#|\))/u);
  });
});
