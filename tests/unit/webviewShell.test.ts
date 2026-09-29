import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWebviewHtml } from "../../src/webview/app/shell";

void describe("Webview shell", () => {
  void it("renders the DevWorkspace placeholder", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /class="brand">DevWorkspace<\/p>/);
    assert.match(html, /<h1>Home<\/h1>/);
    assert.match(html, /local-first developer command center/i);
    for (const area of ["Home", "Jira", "Workspace", "Notes", "Knowledge"]) {
      assert.match(html, new RegExp(`>${area}<`));
    }
  });

  void it("uses nonce-restricted scripts and styles", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /default-src 'none'/);
    assert.match(html, /style-src vscode-webview:\/\/test 'nonce-[^']+'/);
    assert.match(html, /script-src 'nonce-[^']+'/);
    assert.match(html, /<script nonce="[^"]+">/);
    assert.doesNotMatch(html, /https?:\/\//);
    assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  });

  void it("renders untrusted note content only as text", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /heading\.textContent = note\.title/);
    assert.match(html, /content\.textContent = note\.content/);
    assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|document\.write/);
  });
});
