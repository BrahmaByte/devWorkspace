import * as vscode from "vscode";

import { NoteService } from "../application/services/noteService";
import { getDatabasePath } from "../infrastructure/database/location";
import { LocalDatabase } from "../infrastructure/database/localDatabase";
import { NoteRepository } from "../infrastructure/database/noteRepository";
import { createPlatformService } from "../platform/platformService";
import { createWebviewHtml } from "../webview/app/shell";
import type {
  ExtensionResponse,
  ShellPage,
} from "../webview/protocol/messages";
import { parseWebviewRequest } from "../webview/protocol/validation";

const OPEN_COMMAND = "devworkspace.open";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const database = await LocalDatabase.open(
    getDatabasePath(context.globalStorageUri.fsPath),
  );
  const noteService = new NoteService(new NoteRepository(database));
  context.subscriptions.push({
    dispose: () => {
      database.close();
    },
  });

  const openDevWorkspace = vscode.commands.registerCommand(OPEN_COMMAND, () => {
    const platform = createPlatformService();
    let activePage: ShellPage = "home";
    let noteQuery = "";
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

    const sendNotes = (query = ""): Thenable<boolean> => {
      noteQuery = query;
      const state = noteService.getState(query);
      return panel.webview.postMessage({
        type: "notes.state",
        query,
        ...state,
      } satisfies ExtensionResponse);
    };

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
        try {
          const request = parsed.value;
          switch (request.type) {
            case "shell.ready":
              await sendState();
              await sendNotes();
              return;
            case "navigation.select":
              activePage = request.page;
              await sendState();
              if (activePage === "notes") await sendNotes();
              return;
            case "notes.refresh":
              await sendNotes(request.query);
              return;
            case "notes.create":
              await noteService.createNote(request.title, request.content);
              break;
            case "notes.update":
              await noteService.updateNote(
                request.id,
                request.title,
                request.content,
              );
              break;
            case "notes.pin":
              await noteService.setPinned(request.id, request.pinned);
              break;
            case "notes.archive":
              await noteService.setArchived(request.id, request.archived);
              break;
            case "notes.delete":
              await noteService.deleteNote(request.id);
              break;
            case "sticky.create":
              await noteService.createStickyNote(
                request.content,
                request.color,
                request.sortOrder,
              );
              break;
            case "sticky.update":
              await noteService.updateStickyNote(
                request.id,
                request.content,
                request.color,
                request.sortOrder,
              );
              break;
            case "sticky.delete":
              await noteService.deleteStickyNote(request.id);
              break;
          }
          await sendNotes(noteQuery);
        } catch {
          await panel.webview.postMessage({
            type: "protocol.error",
            code: "operation_failed",
            message: "DevWorkspace could not complete the note operation.",
          } satisfies ExtensionResponse);
        }
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
