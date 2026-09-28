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
      .status { bottom: 1rem; color: var(--vscode-descriptionForeground); font-size: 0.8rem; left: 1rem; position: fixed; }
      .status[data-error="true"] { color: var(--vscode-errorForeground); }
      @media (max-width: 640px) { .shell { grid-template-columns: 1fr; } aside { border-bottom: 1px solid var(--vscode-sideBar-border, transparent); border-right: 0; } nav { grid-template-columns: repeat(5, minmax(0, 1fr)); } nav button { overflow: hidden; text-align: center; text-overflow: ellipsis; } }
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
        <section data-view="notes" hidden><h1>Notes</h1><p>Local notes and sticky notes arrive after persistence.</p></section>
        <section data-view="knowledge" hidden><h1>Knowledge</h1><p>Linked Confluence knowledge arrives in a later milestone.</p></section>
      </main>
    </div>
    <div class="status" role="status" aria-live="polite">Starting…</div>
    <script nonce="${nonce}">
      (() => {
        const vscode = acquireVsCodeApi();
        const allowedPages = new Set(["home", "jira", "workspace", "notes", "knowledge"]);
        const status = document.querySelector(".status");
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
            } else if (message?.type === "protocol.error") showError();
          } catch { showError(); }
        });
        document.querySelectorAll("[data-page]").forEach((button) => {
          button.addEventListener("click", () => {
            vscode.postMessage({ type: "navigation.select", page: button.dataset.page });
          });
        });
        vscode.postMessage({ type: "shell.ready" });
      })();
    </script>
  </body>
</html>`;
}
