import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseWebviewRequest } from "../../src/webview/protocol/validation";

void describe("Webview protocol validation", () => {
  void it("accepts allowlisted shell messages", () => {
    assert.deepEqual(parseWebviewRequest({ type: "shell.ready" }), {
      ok: true,
      value: { type: "shell.ready" },
    });
    assert.deepEqual(
      parseWebviewRequest({ type: "navigation.select", page: "notes" }),
      {
        ok: true,
        value: { type: "navigation.select", page: "notes" },
      },
    );
  });

  void it("rejects unknown, malformed, and over-posted messages", () => {
    for (const message of [
      null,
      "navigation.select",
      { type: "unknown" },
      { type: "navigation.select", page: "settings" },
      { type: "navigation.select", page: "home", command: "rm -rf" },
      { type: "notes.create", title: "x", content: "x", extra: true },
      { type: "notes.delete", id: "../../etc/passwd" },
      {
        type: "sticky.create",
        content: "x",
        color: "url(javascript:1)",
        sortOrder: 0,
      },
    ]) {
      assert.equal(parseWebviewRequest(message).ok, false);
    }
  });

  void it("accepts only bounded note operations", () => {
    assert.equal(
      parseWebviewRequest({
        type: "notes.create",
        title: "Safe",
        content: "<script>plain text</script>",
      }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({ type: "notes.refresh", query: "x".repeat(201) }).ok,
      false,
    );
    assert.equal(
      parseWebviewRequest({
        type: "notes.create",
        title: "x".repeat(201),
        content: "",
      }).ok,
      false,
    );
  });
});
