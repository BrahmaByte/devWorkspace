import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseWebviewRequest } from "../../src/webview/protocol/validation";

void describe("Webview protocol validation", () => {
  void it("accepts allowlisted shell messages", () => {
    assert.deepEqual(parseWebviewRequest({ type: "shell.ready" }), {
      ok: true,
      value: { type: "shell.ready" },
    });
    assert.deepEqual(parseWebviewRequest({ type: "home.refresh" }), {
      ok: true,
      value: { type: "home.refresh" },
    });
    assert.deepEqual(
      parseWebviewRequest({ type: "home.search", query: "runbook" }),
      { ok: true, value: { type: "home.search", query: "runbook" } },
    );
    assert.equal(
      parseWebviewRequest({
        type: "jira.connect",
        displayName: "Corporate Jira",
        baseUrl: "https://jira.example.test",
      }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({ type: "jira.issue", issueKey: "DEV-7" }).ok,
      true,
    );
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
      { type: "home.refresh", extra: true },
      { type: "home.search", query: "x".repeat(201) },
      {
        type: "jira.connect",
        displayName: "Jira",
        baseUrl: "x",
        token: "secret",
      },
      { type: "jira.issue", issueKey: "../../etc/passwd" },
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
        workingDirectory: "/work/scripts",
      }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({
        type: "commands.create",
        name: "Bad",
        command: "npm test\nrm -rf /",
      }).ok,
      false,
    );
    assert.equal(
      parseWebviewRequest({
        type: "commands.create",
        name: "Unsafe fields",
        command: "git status",
        shell: "/bin/sh",
        confirmationPolicy: "never",
      }).ok,
      false,
    );
    assert.equal(
      parseWebviewRequest({
        type: "commands.create",
        name: "Host-owned platform",
        command: "git status",
        platform: "linux",
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
