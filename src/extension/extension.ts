import * as vscode from "vscode";

import { createPlatformService } from "../platform/platformService";
import { createWebviewHtml } from "../webview/app/shell";
import type {
  ExtensionResponse,
  ShellPage,
} from "../webview/protocol/messages";
import { parseWebviewRequest } from "../webview/protocol/validation";

const OPEN_COMMAND = "devworkspace.open";

export function activate(context: vscode.ExtensionContext): void {
  const openDevWorkspace = vscode.commands.registerCommand(OPEN_COMMAND, () => {
    const platform = createPlatformService();
    let activePage: ShellPage = "home";
    const panel = vscode.window.createWebviewPanel(
      "devworkspace.main",
      "DevWorkspace",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
      },
    );

    panel.webview.html = createWebviewHtml(panel.webview.cspSource);

    const sendState = (): Thenable<boolean> =>
      panel.webview.postMessage({
        type: "shell.state",
        page: activePage,
        platform: platform.operatingSystem,
      } satisfies ExtensionResponse);

    const messageSubscription = panel.webview.onDidReceiveMessage(
      async (message: unknown) => {
        const parsed = parseWebviewRequest(message);
        if (!parsed.ok) {
          await panel.webview.postMessage({
            type: "protocol.error",
            code: "invalid_message",
            message: "DevWorkspace rejected an invalid Webview message.",
          } satisfies ExtensionResponse);
          return;
        }
        if (parsed.value.type === "navigation.select")
          activePage = parsed.value.page;
        await sendState();
      },
    );

    panel.onDidDispose(() => {
      messageSubscription.dispose();
    });
  });

  context.subscriptions.push(openDevWorkspace);
}

export function deactivate(): void {
  // No resources survive extension deactivation in the scaffold.
}
