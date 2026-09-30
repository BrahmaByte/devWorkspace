import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Script } from "node:vm";

import { createWebviewHtml } from "../../src/webview/app/shell";

void describe("Webview shell", () => {
  void it("emits syntactically valid inline scripts", () => {
    const html = createWebviewHtml("vscode-webview://test");
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)];

    assert.ok(scripts.length > 0);
    for (const script of scripts) {
      assert.doesNotThrow(() => new Script(script[1] ?? ""));
    }
  });

  void it("renders the DevDashboard placeholder", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /id="greeting" class="brand"><\/p>/);
    assert.match(html, /<header class="app-header">/);
    assert.match(html, /Sticky notes/);
    for (const area of [
      "Home",
      "Jira",
      "Workspace",
      "Notes",
      "Knowledge",
      "Settings",
    ]) {
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

  void it("keeps Home focused on sticky notes and current Jira work", () => {
    const html = createWebviewHtml("vscode-webview://test");
    const homeMarkup =
      html.match(/data-view="home">([\s\S]*?)<\/section>/u)?.[1] ?? "";

    assert.match(homeMarkup, /class="dashboard-card sticky-widget"/);
    assert.match(homeMarkup, /Current Jira task/);
    assert.doesNotMatch(
      html,
      /Current project|Quick actions|Favourite projects|Recent resources/,
    );
    assert.doesNotMatch(homeMarkup, /id="global-search"/);
    assert.match(html, /message\?\.type==="home\.state"/);
    assert.match(html, /renderHome=/);
    assert.doesNotMatch(
      html,
      /Sukanto|Jira OK|Confluence OK|Security Month|GCP Dev|Personal Desk/,
    );
    assert.match(html, /class="notes-browser"/);
    assert.match(html, /class="note-editor"/);
  });

  void it("provides fixed sticky previews, URL groups, and persistent card layouts", () => {
    const html = createWebviewHtml("vscode-webview://test");
    assert.match(html, /height:8rem/);
    assert.match(html, /URL groups/);
    assert.match(html, /type:"urls\.openAll"/);
    assert.match(html, /type:"urls\.open"/);
    assert.match(html, /initializeCardLayouts/);
    assert.match(html, /ResizeObserver/);
    assert.match(html, /cardLayouts/);
    assert.match(
      html,
      /iconButton\("grip","Drag to rearrange card",\(\)=>\{\}\)/,
    );
    assert.match(html, /handle\.draggable=true/);
    assert.match(html, /event\.key==="ArrowUp"/);
    assert.match(html, /persistCardOrder/);
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
    assert.match(html, /iconButton\("terminal","Open terminal"/);
    assert.doesNotMatch(html, /id="project-ide"|projects\.favourite/);
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

  void it("shows the theme action with the correct sun or moon icon", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /<symbol id="i-sun"/);
    assert.match(html, /<symbol id="i-moon"/);
    assert.match(html, /isLight\?"#i-moon":"#i-sun"/);
  });

  void it("keeps Jira credentials out of the Webview", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /id="jira-form"/);
    assert.match(html, /type:"jira\.connect"/);
    assert.match(html, /message\?\.type==="jira\.state"/);
    assert.match(html, /function renderJira/);
    assert.match(html, /data-view="settings"/);
    assert.match(html, /class="settings-nav"/);
    assert.doesNotMatch(html, /id="jira-(?:pat|token)"/);
    assert.doesNotMatch(html, /Authorization|Bearer/);
    assert.match(html, /id="jira-settings-message"/);
    assert.match(html, /message\?\.type==="integration\.error"/);
    assert.match(html, /Connecting…/);
  });

  void it("keeps Confluence configuration in Settings and renders metadata-only search", () => {
    const html = createWebviewHtml("vscode-webview://test");
    assert.match(html, /id="confluence-form"/);
    assert.match(html, /id="confluence-search"/);
    assert.match(html, /type:"confluence\.connect"/);
    assert.match(html, /type:"confluence\.search"/);
    assert.match(html, /type:"confluence\.open"/);
    assert.match(html, /page\.title/);
    assert.doesNotMatch(html, /id="confluence-(?:pat|token)"/);
    assert.match(html, /id="confluence-settings-message"/);
    assert.match(html, /class="knowledge-app"/);
    assert.match(html, /id="confluence-detail"/);
    assert.match(html, /id="confluence-note-target"/);
    assert.match(html, /targetType:"confluence_page"/);
    assert.match(html, /Reference saved to note/);
  });

  void it("provides a Kanban board and constrained Start Work controls", () => {
    const html = createWebviewHtml("vscode-webview://test");

    assert.match(html, /id="jira-search"/);
    assert.match(html, /class="jira-board"/);
    assert.match(html, /className="jira-column"/);
    assert.match(html, /To Do|In Progress|Done/);
    assert.match(html, /Custom JQL filter/);
    assert.match(html, /id="jira-local-form"/);
    assert.match(html, /type:"jira\.local\.create"/);
    assert.match(html, /type:"jira\.search"/);
    assert.match(html, /type:"jira\.associate"/);
    assert.match(html, /type:"jira\.startWork"/);
    assert.match(html, /type:"jira\.open"/);
    assert.match(html, /jira-detail-grid/);
    assert.match(html, /message\.state\?\.filter/);
    assert.match(html, /Optional branch name/);
    assert.doesNotMatch(html, /type:"jira\.startWork"[^\n]*command:/);
  });

  void it("provides host-validated linked context for notes", () => {
    const html = createWebviewHtml("vscode-webview://test");
    assert.match(html, /id="knowledge-links"/);
    assert.match(html, /id="knowledge-candidate"/);
    assert.match(html, /type:"knowledge\.list"/);
    assert.match(html, /type:"knowledge\.attach"/);
    assert.match(html, /type:"knowledge\.detach"/);
    assert.match(html, /type:"knowledge\.open"/);
    assert.doesNotMatch(html, /type:"knowledge\.open"[^\n]*url:/);
  });

  void it("provides a dedicated global search page with safe result rendering", () => {
    const html = createWebviewHtml("vscode-webview://test");
    assert.match(html, /data-view="search"/);
    assert.match(html, /aria-label="Global search"/);
    assert.match(html, /type:"search\.query"/);
    assert.match(html, /type:"search\.open"/);
    assert.match(html, /item\.title/);
    assert.doesNotMatch(html, /results\.innerHTML/);
  });
});
