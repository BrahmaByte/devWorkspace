import { randomBytes } from "node:crypto";

export function createWebviewHtml(cspSource: string): string {
  const nonce = randomBytes(16).toString("base64");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DevWorkspace</title>
    <style nonce="${nonce}">
      :root { color-scheme: light dark; font-family: var(--vscode-font-family); }
      * { box-sizing: border-box; }
      body { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; min-height: 100vh; }
      .shell { display: grid; grid-template-columns: 14rem 1fr; min-height: 100vh; }
      aside { background: var(--vscode-sideBar-background); border-right: 1px solid var(--vscode-sideBar-border, transparent); padding: 1rem; }
      .brand { font-size: 1.1rem; font-weight: 700; margin: 0 0 1.25rem; }
      nav { display: grid; gap: 0.35rem; }
      nav button { background: transparent; border: 0; border-radius: 0.3rem; color: var(--vscode-sideBar-foreground); cursor: pointer; font: inherit; padding: 0.65rem 0.75rem; text-align: left; }
      nav button:hover { background: var(--vscode-list-hoverBackground); }
      nav button[aria-current="page"] { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
      main { padding: 2.5rem clamp(1.5rem, 5vw, 5rem); }
      section[hidden] { display: none; }
      h1 { margin-top: 0; }
      p { color: var(--vscode-descriptionForeground); line-height: 1.6; max-width: 44rem; }
      input, textarea, select, button { font: inherit; }
      input, textarea, select { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); padding: 0.55rem; width: 100%; }
      textarea { min-height: 9rem; resize: vertical; }
      .notes-layout { display: grid; gap: 1.5rem; grid-template-columns: minmax(16rem, 1fr) minmax(20rem, 2fr); }
      .card { border: 1px solid var(--vscode-widget-border, var(--vscode-sideBar-border)); border-radius: 0.4rem; padding: 1rem; }
      .field { display: grid; gap: 0.35rem; margin-bottom: 0.75rem; }
      .actions, .item-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
      .actions button, .item-actions button { background: var(--vscode-button-secondaryBackground); border: 0; border-radius: 0.25rem; color: var(--vscode-button-secondaryForeground); cursor: pointer; padding: 0.45rem 0.7rem; }
      .actions button:first-child { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
      .list { display: grid; gap: 0.75rem; margin-top: 1rem; }
      .note-title { font-size: 1rem; margin: 0; }
      .note-content { color: var(--vscode-editor-foreground); margin: 0.6rem 0; white-space: pre-wrap; word-break: break-word; }
      .meta { color: var(--vscode-descriptionForeground); font-size: 0.78rem; margin: 0 0 0.6rem; }
      .stickies { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); }
      .sticky[data-color="yellow"] { border-left: 0.35rem solid #d7ba7d; }
      .sticky[data-color="blue"] { border-left: 0.35rem solid #75beff; }
      .sticky[data-color="green"] { border-left: 0.35rem solid #89d185; }
      .sticky[data-color="pink"] { border-left: 0.35rem solid #f28bca; }
      .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
      .status { bottom: 1rem; color: var(--vscode-descriptionForeground); font-size: 0.8rem; left: 1rem; position: fixed; }
      .status[data-error="true"] { color: var(--vscode-errorForeground); }
      @media (max-width: 760px) { .shell, .notes-layout { grid-template-columns: 1fr; } aside { border-bottom: 1px solid var(--vscode-sideBar-border, transparent); border-right: 0; } nav { grid-template-columns: repeat(5, minmax(0, 1fr)); } nav button { overflow: hidden; text-align: center; text-overflow: ellipsis; } }
    </style>
  </head>
  <body>
    <div class="shell">
      <aside>
        <p class="brand">DevWorkspace</p>
        <nav aria-label="DevWorkspace areas">
          <button type="button" data-page="home" aria-current="page">Home</button>
          <button type="button" data-page="jira">Jira</button>
          <button type="button" data-page="workspace">Workspace</button>
          <button type="button" data-page="notes">Notes</button>
          <button type="button" data-page="knowledge">Knowledge</button>
        </nav>
      </aside>
      <main>
        <section data-view="home"><h1>Home</h1><p>Your local-first developer command center.</p></section>
        <section data-view="jira" hidden><h1>Jira</h1><p>Jira connection and work views arrive in later milestones.</p></section>
        <section data-view="workspace" hidden><h1>Workspace</h1><p>Projects, terminals, and controlled commands will live here.</p></section>
        <section data-view="notes" hidden>
          <h1>Notes</h1>
          <div class="notes-layout">
            <div>
              <form id="note-form" class="card">
                <input id="note-id" type="hidden" />
                <label class="field">Title<input id="note-title" maxlength="200" required /></label>
                <label class="field">Content<textarea id="note-content" maxlength="500000"></textarea></label>
                <div class="actions"><button type="submit">Save note</button><button id="note-clear" type="button">Clear</button></div>
              </form>
              <form id="sticky-form" class="card">
                <h2>Sticky note</h2><input id="sticky-id" type="hidden" />
                <label class="field">Content<textarea id="sticky-content" maxlength="10000" required></textarea></label>
                <label class="field">Color<select id="sticky-color"><option>yellow</option><option>blue</option><option>green</option><option>pink</option></select></label>
                <div class="actions"><button type="submit">Add sticky</button></div>
              </form>
            </div>
            <div>
              <label class="field">Search notes<input id="note-search" type="search" maxlength="200" placeholder="Search title and content" /></label>
              <div id="note-list" class="list" aria-live="polite"></div>
              <h2>Sticky notes</h2><div id="sticky-list" class="stickies" aria-live="polite"></div>
            </div>
          </div>
        </section>
        <section data-view="knowledge" hidden><h1>Knowledge</h1><p>Linked Confluence knowledge arrives in a later milestone.</p></section>
      </main>
    </div>
    <div class="status" role="status" aria-live="polite">Starting…</div>
    <script nonce="${nonce}">
      (() => {
        const vscode = acquireVsCodeApi();
        const allowedPages = new Set(["home", "jira", "workspace", "notes", "knowledge"]);
        const status = document.querySelector(".status");
        const noteId = document.querySelector("#note-id");
        const noteTitle = document.querySelector("#note-title");
        const noteContent = document.querySelector("#note-content");
        const noteSearch = document.querySelector("#note-search");
        const noteList = document.querySelector("#note-list");
        const stickyList = document.querySelector("#sticky-list");
        const stickyId = document.querySelector("#sticky-id");
        let currentNotes = [];
        const button = (label, action) => {
          const element = document.createElement("button");
          element.type = "button";
          element.textContent = label;
          element.addEventListener("click", action);
          return element;
        };
        const clearEditor = () => { noteId.value = ""; noteTitle.value = ""; noteContent.value = ""; };
        const renderNotes = (notes) => {
          noteList.replaceChildren();
          if (notes.length === 0) { const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "No notes found."; noteList.append(empty); }
          notes.forEach((note) => {
            const article = document.createElement("article"); article.className = "card";
            const heading = document.createElement("h3"); heading.className = "note-title"; heading.textContent = note.title;
            const meta = document.createElement("p"); meta.className = "meta"; meta.textContent = (note.isPinned ? "Pinned · " : "") + (note.isArchived ? "Archived · " : "") + new Date(note.updatedAt).toLocaleString();
            const content = document.createElement("p"); content.className = "note-content"; content.textContent = note.content;
            const actions = document.createElement("div"); actions.className = "item-actions";
            actions.append(
              button("Edit", () => { noteId.value = note.id; noteTitle.value = note.title; noteContent.value = note.content; noteTitle.focus(); }),
              button(note.isPinned ? "Unpin" : "Pin", () => vscode.postMessage({ type: "notes.pin", id: note.id, pinned: !note.isPinned })),
              button(note.isArchived ? "Restore" : "Archive", () => vscode.postMessage({ type: "notes.archive", id: note.id, archived: !note.isArchived })),
              button("Delete", () => vscode.postMessage({ type: "notes.delete", id: note.id }))
            );
            article.append(heading, meta, content, actions); noteList.append(article);
          });
        };
        const renderStickies = (notes) => {
          stickyList.replaceChildren();
          if (notes.length === 0) { const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "No sticky notes yet."; stickyList.append(empty); }
          notes.forEach((note) => {
            const article = document.createElement("article"); article.className = "card sticky"; article.dataset.color = note.color;
            const content = document.createElement("p"); content.className = "note-content"; content.textContent = note.content;
            const actions = document.createElement("div"); actions.className = "item-actions";
            actions.append(
              button("Edit", () => { stickyId.value = note.id; document.querySelector("#sticky-content").value = note.content; document.querySelector("#sticky-color").value = note.color; }),
              button("Delete", () => vscode.postMessage({ type: "sticky.delete", id: note.id }))
            );
            article.append(content, actions); stickyList.append(article);
          });
        };
        const showError = () => {
          status.textContent = "The DevWorkspace shell encountered an error.";
          status.dataset.error = "true";
        };
        const selectPage = (page) => {
          if (!allowedPages.has(page)) return;
          document.querySelectorAll("[data-page]").forEach((button) => {
            if (button.dataset.page === page) button.setAttribute("aria-current", "page");
            else button.removeAttribute("aria-current");
          });
          document.querySelectorAll("[data-view]").forEach((view) => {
            view.hidden = view.dataset.view !== page;
          });
        };
        window.addEventListener("error", showError);
        window.addEventListener("unhandledrejection", showError);
        window.addEventListener("message", (event) => {
          try {
            const message = event.data;
            if (message?.type === "shell.state" && allowedPages.has(message.page)) {
              selectPage(message.page);
              status.textContent = "Ready · " + message.platform;
              status.dataset.error = "false";
            } else if (message?.type === "notes.state" && Array.isArray(message.notes) && Array.isArray(message.stickyNotes)) {
              currentNotes = message.notes; noteSearch.value = typeof message.query === "string" ? message.query : ""; renderNotes(currentNotes); renderStickies(message.stickyNotes);
              status.textContent = "Notes saved locally"; status.dataset.error = "false";
            } else if (message?.type === "protocol.error") showError();
          } catch { showError(); }
        });
        document.querySelectorAll("[data-page]").forEach((button) => {
          button.addEventListener("click", () => {
            vscode.postMessage({ type: "navigation.select", page: button.dataset.page });
          });
        });
        document.querySelector("#note-form").addEventListener("submit", (event) => {
          event.preventDefault();
          const id = noteId.value;
          vscode.postMessage(id ? { type: "notes.update", id, title: noteTitle.value, content: noteContent.value } : { type: "notes.create", title: noteTitle.value, content: noteContent.value });
          clearEditor();
        });
        document.querySelector("#note-clear").addEventListener("click", clearEditor);
        noteSearch.addEventListener("input", () => vscode.postMessage({ type: "notes.refresh", query: noteSearch.value }));
        document.querySelector("#sticky-form").addEventListener("submit", (event) => {
          event.preventDefault();
          const content = document.querySelector("#sticky-content"); const color = document.querySelector("#sticky-color");
          vscode.postMessage(stickyId.value ? { type: "sticky.update", id: stickyId.value, content: content.value, color: color.value, sortOrder: 0 } : { type: "sticky.create", content: content.value, color: color.value, sortOrder: 0 }); content.value = ""; stickyId.value = "";
        });
        vscode.postMessage({ type: "shell.ready" });
      })();
    </script>
  </body>
</html>`;
}
