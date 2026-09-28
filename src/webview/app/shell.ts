import { randomBytes } from "node:crypto";

export function createWebviewHtml(cspSource: string): string {
  const nonce = randomBytes(16).toString("base64");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; img-src ${cspSource} data:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DevWorkspace</title>
    <style nonce="${nonce}">
      :root {
        color-scheme: light dark;
        font-family: var(--vscode-font-family);
      }

      body {
        align-items: center;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        display: flex;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
      }

      main {
        max-width: 42rem;
        padding: 3rem;
        text-align: center;
      }

      p {
        color: var(--vscode-descriptionForeground);
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>DevWorkspace</h1>
      <p>Your local-first developer command center is ready for its next milestone.</p>
    </main>
  </body>
</html>`;
}
