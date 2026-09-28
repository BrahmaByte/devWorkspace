import * as vscode from "vscode";

import { createWebviewHtml } from "../webview/app/shell";

const OPEN_COMMAND = "devworkspace.open";

export function activate(context: vscode.ExtensionContext): void {
  const openDevWorkspace = vscode.commands.registerCommand(OPEN_COMMAND, () => {
    const panel = vscode.window.createWebviewPanel(
      "devworkspace.main",
      "DevWorkspace",
      vscode.ViewColumn.One,
      {
        enableScripts: false,
        retainContextWhenHidden: false,
      },
    );

    panel.webview.html = createWebviewHtml(panel.webview.cspSource);
  });

  context.subscriptions.push(openDevWorkspace);
}

export function deactivate(): void {
  // No resources survive extension deactivation in the scaffold.
}
