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
      parseWebviewRequest({
        type: "commands.create",
        name: "Status",
        command: "git status",
        platform: "any",
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

  void it("accepts validated workspace operations and rejects over-posting", () => {
    assert.deepEqual(parseWebviewRequest({ type: "projects.browse" }), {
      ok: true,
      value: { type: "projects.browse" },
    });
    assert.deepEqual(parseWebviewRequest({ type: "commands.browse" }), {
      ok: true,
      value: { type: "commands.browse" },
    });
    assert.equal(
      parseWebviewRequest({
        type: "projects.create",
        name: "API",
        localPath: "/work/api",
        preferredIde: "vscode",
      }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({
        type: "commands.create",
        name: "Test",
        command: "npm test",
        platform: "linux",
        workingDirectory: "/work/scripts",
      }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({
        type: "commands.create",
        name: "Bad",
        command: "npm test\nrm -rf /",
        platform: "linux",
      }).ok,
      false,
    );
    assert.equal(
      parseWebviewRequest({
        type: "commands.create",
        name: "Unsafe fields",
        command: "git status",
        platform: "any",
        shell: "/bin/sh",
        confirmationPolicy: "never",
      }).ok,
      false,
    );
    assert.equal(
      parseWebviewRequest({
        type: "projects.create",
        name: "API",
        localPath: "/work/api",
        token: "secret",
      }).ok,
      false,
    );
  });
});
