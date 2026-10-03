import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SelectedPathAuthorizer } from "../../src/application/services/pathAuthorizationService";
import { isDangerousCommand } from "../../src/application/services/workspaceService";
import { createWebviewHtml } from "../../src/webview/app/shell";
import { parseWebviewRequest } from "../../src/webview/protocol/validation";

void describe("security boundaries", () => {
  void it("rejects malicious and over-posted Webview messages", () => {
    const payloads = [
      { type: "commands.execute", id: "../../etc/passwd" },
      { type: "commands.create", name: "x", command: "echo ok\nwhoami" },
      { type: "projects.create", name: "x", localPath: "/tmp", shell: "sh" },
      { type: "confluence.open", id: "https://attacker.invalid" },
      { type: "navigation.select", page: "home", __proto__: { admin: true } },
      { type: "jira.connect", displayName: "x", baseUrl: "x", pat: "fake" },
      { type: "apps.launch", id: "x", executablePath: "/bin/sh" },
      { type: "apps.browse", executablePath: "/bin/sh" },
    ];
    for (const payload of payloads)
      assert.equal(parseWebviewRequest(payload).ok, false);
  });

  void it("keeps XSS payloads inert and enforces a restrictive CSP", () => {
    const html = createWebviewHtml("vscode-webview://security-test");
    assert.match(html, /default-src 'none'/u);
    assert.match(html, /script-src 'nonce-[^']+'/u);
    assert.doesNotMatch(html, /script-src[^;]*'unsafe-inline'/u);
    assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|document\.write/u);
    assert.match(html, /\.textContent=/u);
  });

  void it("requires a native picker authorization for new filesystem paths", () => {
    const paths = new SelectedPathAuthorizer();
    assert.equal(paths.consume("/private/project"), false);
    paths.authorize("/chosen/project");
    assert.equal(paths.consume("/chosen/project/../private/project"), false);
    assert.equal(paths.consume("/chosen/project"), true);
    assert.equal(paths.consume("/chosen/project"), false);
  });

  void it("recognizes representative destructive commands", () => {
    for (const command of [
      "rm -rf ./build",
      "sudo npm install",
      "git reset --hard HEAD",
      "shutdown -h now",
      "rmdir /s build",
    ])
      assert.equal(isDangerousCommand(command), true);
    assert.equal(isDangerousCommand("npm test -- --runInBand"), false);
  });
});
