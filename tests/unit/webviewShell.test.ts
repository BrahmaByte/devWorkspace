import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWebviewHtml } from "../../src/webview/app/shell";

void describe("Webview shell", () => {
  void it("renders the DevWorkspace placeholder", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /class="brand">DevWorkspace<\/p>/);
    assert.match(html, /<header class="app-header">/);
    assert.match(html, /local-first developer command center/i);
    for (const area of ["Home", "Jira", "Workspace", "Notes", "Knowledge"]) {
      assert.match(html, new RegExp(`>${area}<`));
    }
  });

  void it("provides a persistent global theme toggle and live header clock", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /id="theme-toggle"/);
    assert.match(html, /id="clock"/);
    assert.match(html, /vscode\.getState\(\)/);
    assert.match(html, /vscode\.setState/);
    assert.match(html, /setInterval\(updateClock,1000\)/);
  });

  void it("uses a dashboard sticky widget and three-pane notes workspace", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /class="dashboard-card sticky-widget"/);
    assert.match(html, /class="notes-folders"/);
    assert.match(html, /class="notes-browser"/);
    assert.match(html, /class="note-editor"/);
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

    assert.match(html, /heading\.textContent=.*note\.title/);
    assert.match(html, /content\.textContent=note\.content/);
    assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|document\.write/);
  });
});
