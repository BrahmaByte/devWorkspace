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
      ...readme.matchAll(/\]\((assets\/screenshots\/[^)]+\.png)\)/gu),
    ];
    assert.equal(screenshots.length, 6);
    for (const match of screenshots) {
      const bytes = readFileSync(resolve(root, match[1]!));
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    }
    assert.doesNotMatch(readme, /\]\([^)]*\.md(?:#|\))/u);
    assert.doesNotMatch(readme, /Install from VSIX|manual installation/u);
    assert.match(readme, /assets\/screenshots\/carousel\.gif/u);
    const gif = readFileSync(resolve(root, "assets/screenshots/carousel.gif"));
    assert.match(gif.subarray(0, 6).toString(), /^GIF8[79]a$/u);
    let offset = 13,
      frames = 0;
    if (gif[10]! & 0x80) offset += 3 * 2 ** ((gif[10]! & 7) + 1);
    const skipBlocks = () => {
      while (offset < gif.length) {
        const length = gif[offset++]!;
        if (!length) return;
        offset += length;
      }
      assert.fail("Truncated GIF block");
    };
    while (offset < gif.length) {
      const marker = gif[offset++];
      if (marker === 0x3b) break;
      if (marker === 0x21) {
        offset++;
        skipBlocks();
      } else if (marker === 0x2c) {
        frames++;
        const flags = gif[offset + 8]!;
        offset += 9;
        if (flags & 0x80) offset += 3 * 2 ** ((flags & 7) + 1);
        offset++;
        skipBlocks();
      } else assert.fail("Invalid GIF frame marker");
    }
    assert.equal(frames, 6);
  });
});
