import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWebviewHtml } from "../../src/webview/app/shell";

void describe("Webview shell", () => {
  void it("renders the DevWorkspace placeholder", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /id="greeting" class="brand"><\/p>/);
    assert.match(html, /<header class="app-header">/);
    assert.match(html, /Sticky Notes Board/);
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
    assert.match(html, /grid-column:2/);
    assert.match(html, /grid-row:1\/-1/);
    assert.match(html, /linear-gradient/);
    assert.match(html, /radial-gradient/);
  });

  void it("uses the reference dashboard cards and split notes workspace", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /class="dashboard-card sticky-widget"/);
    assert.match(html, /Quick App Launcher/);
    assert.match(html, /Next Meeting/);
    assert.match(html, /Daily Dev URLs/);
    assert.match(html, /Current Jira Task/);
    assert.match(html, /Today's Schedule/);
    assert.doesNotMatch(
      html,
      /Sukanto|Jira OK|Confluence OK|Security Month|GCP Dev|Personal Desk/,
    );
    assert.match(html, /class="notes-browser"/);
    assert.match(html, /class="note-editor"/);
  });

  void it("uses nonce-restricted scripts and styles", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /default-src 'none'/);
    assert.match(html, /style-src vscode-webview:\/\/test 'nonce-[^']+'/);
    assert.match(html, /script-src 'nonce-[^']+'/);
    assert.match(html, /<script nonce="[^"]+">/);
    assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);
    assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  });

  void it("renders untrusted note content only as text", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /heading\.textContent=.*note\.title/);
    assert.match(html, /content\.textContent=note\.content/);
    assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|document\.write/);
  });

  void it("autosaves edits and opens sticky notes in a modal editor", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /id="sticky-dialog"/);
    assert.match(html, /stickyDialog\.showModal\(\)/);
    assert.match(
      html,
      /setTimeout\(\(\)=>\{autosaveTimer=undefined;noteId\.value\?saveExisting\(\):createDraft\(\)/,
    );
    assert.match(html, /const flushAutosave=/);
    assert.match(
      html,
      /noteContent\.addEventListener\("input",scheduleAutosave\)/,
    );
    assert.match(html, /const createDraft=/);
    assert.match(html, /message\?\.type==="notes\.created"/);
    assert.match(html, /type:"notes\.create",\.\.\.creatingSnapshot/);
    assert.match(html, /aria-label="Delete note" title="Delete note">/);
    assert.match(html, /<symbol id="i-trash"/);
    assert.match(html, /<use href="#i-trash"\/>/);
  });

  void it("uses platform-neutral SVG icons with hover hints", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /class="svg-sprite"/);
    assert.match(html, /aria-label="New note" title="New note"/);
    assert.match(html, /data-page="home"[^>]*title="Home"/);
    assert.doesNotMatch(html, />[⌂⌖⌫☾☀✎✓×＋▣▤◇]</);
  });

  void it("provides icon-driven workspace management", () => {
    const html = createWebviewHtml("vscode-webview://test");

    for (const id of ["project-form", "command-form", "environment-form"])
      assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, /message\?\.type==="workspace\.state"/);
    assert.match(html, /type:"commands\.execute"/);
    assert.match(html, /aria-label="Save command" title="Save command"/);
    assert.match(
      html,
      /id="project-browse"[^>]*aria-label="Browse for project folder"/,
    );
    assert.match(html, /type:"projects\.browse"/);
    assert.match(
      html,
      /id="command-browse"[^>]*aria-label="Browse for terminal folder"/,
    );
    assert.match(html, /type:"commands\.browse"/);
    assert.match(html, /message\?\.type==="commands\.pathSelected"/);
    assert.match(html, /project\.gitBranch/);
    assert.match(html, /className="git-branch"/);
    assert.doesNotMatch(
      html,
      /id="command-project"|id="command-shell"|id="command-policy"|id="command-platform"/,
    );
    assert.doesNotMatch(html, /querySelector\("#command-project"\)/);
    assert.match(
      html,
      /fillProjectSelect=\(select,includeAll\)=>\{if\(!select\)return/,
    );
    assert.match(html, /class="icon-button primary-icon-button"/);
    assert.match(html, /workspace-item-copy strong\{display:inline-block\}/);
    assert.match(
      html,
      /workspace-item-copy small\{overflow-wrap:anywhere;white-space:pre-wrap\}/,
    );
    assert.match(html, /class="command-input"[^>]*spellcheck="false"/);
    assert.match(
      html,
      /workspace-grid\{gap:[^}]*grid-template-columns:minmax\(0,1fr\)/,
    );
  });
});
