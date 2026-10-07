import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseWebviewRequest } from "../../src/webview/protocol/validation";

void describe("Webview protocol validation", () => {
  void it("validates saved group edits and whitelists Jira presets", () => {
    const request = {
      type: "urls.update",
      id: "00000000-0000-4000-8000-000000000001",
      name: "Tools",
      urls: ["https://example.test"],
    };
    assert.equal(parseWebviewRequest(request).ok, true);
    assert.equal(parseWebviewRequest({ ...request, id: "../bad" }).ok, false);
    assert.equal(
      parseWebviewRequest({ ...request, credential: "fake" }).ok,
      false,
    );
    for (const preset of ["mine", "reported", "unassigned", "recent", "done"])
      assert.equal(
        parseWebviewRequest({ type: "jira.preset", preset }).ok,
        true,
      );
    for (const preset of ["constructor", "__proto__", "arbitrary", 1])
      assert.equal(
        parseWebviewRequest({ type: "jira.preset", preset }).ok,
        false,
      );
    assert.equal(
      parseWebviewRequest({
        type: "jira.preset",
        preset: "mine",
        query: "ignored",
      }).ok,
      false,
    );
  });
  void it("rejects retired actions and removed project metadata", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    for (const request of [
      { type: "knowledge.list", noteId: id },
      {
        type: "knowledge.attach",
        noteId: id,
        targetType: "project",
        targetId: id,
      },
      { type: "knowledge.detach", noteId: id, relationshipId: id },
      { type: "knowledge.open", targetType: "project", targetId: id },
      { type: "jira.associate", issueKey: "DEV-1", projectId: id },
      {
        type: "jira.startWork",
        issueKey: "DEV-1",
        branchName: "feature/DEV-1",
      },
      { type: "projects.favourite", id, favourite: true },
      { type: "notes.pin", id, pinned: true },
      { type: "notes.archive", id, archived: true },
    ])
      assert.equal(parseWebviewRequest(request).ok, false);
    assert.equal(
      parseWebviewRequest({
        type: "projects.create",
        name: "API",
        localPath: "/work/api",
        preferredIde: "vscode",
      }).ok,
      false,
    );
  });
  void it("strictly bounds comment bodies and pagination", () => {
    const valid = {
      type: "jira.comment.add",
      issueKey: "DEV-1",
      body: "Hello  world\nSecond line",
    };
    assert.deepEqual(parseWebviewRequest(valid), { ok: true, value: valid });
    for (const request of [
      { ...valid, body: " " },
      { ...valid, body: "x".repeat(10001) },
      { ...valid, body: "bad\0" },
      { ...valid, issueKey: "../bad" },
      { ...valid, url: "https://evil.test" },
      { type: "jira.comments", issueKey: "DEV-1", startAt: -1 },
      { type: "jira.comments", issueKey: "DEV-1", startAt: 0.5 },
    ])
      assert.equal(parseWebviewRequest(request).ok, false);
    assert.equal(
      parseWebviewRequest({
        type: "jira.comments",
        issueKey: "DEV-1",
        startAt: 50,
      }).ok,
      true,
    );
  });
  void it("validates Confluence preview identifiers and rejects additional fields", () => {
    assert.equal(
      parseWebviewRequest({ type: "confluence.preview", id: "42" }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({ type: "confluence.preview", id: "../42" }).ok,
      false,
    );
    assert.equal(
      parseWebviewRequest({
        type: "confluence.preview",
        id: "42",
        url: "https://evil.test",
      }).ok,
      false,
    );
  });
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
      parseWebviewRequest({ type: "confluence.search", query: "runbook" }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({ type: "confluence.open", id: "42" }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({ type: "confluence.reader", id: "42" }).ok,
      true,
    );
    const bookmarkId = "00000000-0000-4000-8000-000000000001";
    for (const type of ["confluence.open", "confluence.reader"]) {
      assert.equal(
        parseWebviewRequest({ type, id: "42", noteId: bookmarkId }).ok,
        true,
      );
      assert.equal(
        parseWebviewRequest({ type, id: "42", noteId: "../note" }).ok,
        false,
      );
      assert.equal(
        parseWebviewRequest({
          type,
          id: "42",
          noteId: bookmarkId,
          url: "https://evil.test",
        }).ok,
        false,
      );
    }
    for (const type of ["confluence.preview", "confluence.bookmark"]) {
      assert.equal(
        parseWebviewRequest({ type, id: "42", noteId: bookmarkId }).ok,
        false,
      );
    }
    assert.equal(
      parseWebviewRequest({ type: "confluence.bookmark", id: "42" }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({
        type: "knowledge.list",
        noteId: "00000000-0000-4000-8000-000000000001",
      }).ok,
      false,
    );
    assert.equal(
      parseWebviewRequest({
        type: "knowledge.attach",
        noteId: "00000000-0000-4000-8000-000000000001",
        targetType: "jira_issue",
        targetId: "DEV-7",
      }).ok,
      false,
    );
    assert.equal(
      parseWebviewRequest({ type: "search.query", query: "runbook" }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({
        type: "search.open",
        resultType: "note",
        id: "00000000-0000-4000-8000-000000000001",
      }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({ type: "jira.issue", issueKey: "DEV-7" }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({ type: "jira.open", issueKey: "DEV-7" }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({ type: "jira.search", query: "login failure" }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({
        type: "jira.associate",
        issueKey: "DEV-7",
        projectId: "00000000-0000-0000-0000-000000000007",
      }).ok,
      false,
    );
    assert.equal(
      parseWebviewRequest({
        type: "jira.startWork",
        issueKey: "DEV-7",
        branchName: "feature/DEV-7",
      }).ok,
      false,
    );
    assert.deepEqual(
      parseWebviewRequest({ type: "navigation.select", page: "notes" }),
      {
        ok: true,
        value: { type: "navigation.select", page: "notes" },
      },
    );
    assert.equal(
      parseWebviewRequest({ type: "navigation.select", page: "settings" }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({
        type: "jira.local.create",
        summary: "Review changes",
        status: "todo",
      }).ok,
      true,
    );
  });

  void it("accepts bounded URL group actions", () => {
    assert.equal(
      parseWebviewRequest({
        type: "urls.create",
        name: "Tools",
        urls: ["https://example.test"],
      }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({
        type: "urls.open",
        id: "00000000-0000-4000-8000-000000000000",
        index: 0,
      }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({ type: "urls.create", name: "x", urls: [] }).ok,
      false,
    );
  });

  void it("allows only opaque IDs for developer application actions", () => {
    assert.deepEqual(parseWebviewRequest({ type: "apps.browse" }), {
      ok: true,
      value: { type: "apps.browse" },
    });
    assert.equal(
      parseWebviewRequest({
        type: "apps.launch",
        id: "00000000-0000-4000-8000-000000000000",
      }).ok,
      true,
    );
    assert.equal(
      parseWebviewRequest({
        type: "apps.launch",
        id: "not-an-id",
        executablePath: "/tmp/untrusted",
      }).ok,
      false,
    );
    assert.equal(
      parseWebviewRequest({ type: "apps.browse", path: "/tmp/untrusted" }).ok,
      false,
    );
  });

  void it("rejects unknown, malformed, and over-posted messages", () => {
    for (const message of [
      null,
      "navigation.select",
      { type: "unknown" },
      { type: "navigation.select", page: "admin" },
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
      { type: "jira.search", query: "project = DEV\nOR project = OPS" },
      { type: "jira.local.create", summary: "x", status: "unknown" },
      { type: "jira.local.delete", id: "not-an-id" },
      { type: "confluence.search", query: "bad\nquery" },
      { type: "confluence.open", id: "https://evil.test" },
      { type: "confluence.reader", id: "../42" },
      { type: "confluence.bookmark", id: "https://evil.test" },
      {
        type: "knowledge.attach",
        noteId: "../../etc/passwd",
        targetType: "project",
        targetId: "x",
      },
      {
        type: "knowledge.open",
        targetType: "url",
        targetId: "https://evil.test",
      },
      { type: "search.query", query: "bad\nquery" },
      { type: "search.open", resultType: "url", id: "https://evil.test" },
      {
        type: "confluence.connect",
        displayName: "Docs",
        baseUrl: "https://docs.test",
        token: "secret",
      },
      {
        type: "jira.startWork",
        issueKey: "DEV-7",
        branchName: "x",
        command: "rm -rf /",
      },
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
