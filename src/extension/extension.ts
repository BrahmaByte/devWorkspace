import * as vscode from "vscode";
import { basename } from "node:path";

import { NoteService } from "../application/services/noteService";
import { CommandExecutionService } from "../application/services/commandExecutionService";
import { GitBranchService } from "../application/services/gitBranchService";
import { WorkspaceService } from "../application/services/workspaceService";
import { getDatabasePath } from "../infrastructure/database/location";
import { LocalDatabase } from "../infrastructure/database/localDatabase";
import { NoteRepository } from "../infrastructure/database/noteRepository";
import { WorkspaceRepository } from "../infrastructure/database/workspaceRepository";
import { NodeGitRunner } from "../infrastructure/git/nodeGitRunner";
import {
  VscodeCommandExecutor,
  VscodeConfirmationGateway,
} from "../infrastructure/vscode/vscodeCommandExecutor";
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
  const platform = createPlatformService();
  const workspaceRepository = new WorkspaceRepository(database);
  const workspaceService = new WorkspaceService(
    workspaceRepository,
    platform.operatingSystem,
  );
  const commandExecutionService = new CommandExecutionService(
    workspaceRepository,
    new VscodeCommandExecutor(),
    new VscodeConfirmationGateway(),
    platform.operatingSystem,
  );
  const gitBranchService = new GitBranchService(new NodeGitRunner());
  context.subscriptions.push({
    dispose: () => {
      database.close();
    },
  });

  const openDevWorkspace = vscode.commands.registerCommand(OPEN_COMMAND, () => {
    let activePage: ShellPage = "home";
    let noteQuery = "";
    let selectedCommandPath: string | undefined;
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
    const sendWorkspace = async (): Promise<boolean> => {
      const state = workspaceService.getState();
      const projects = await Promise.all(
        state.projects.map(async (project) => ({
          ...project,
          gitBranch: await gitBranchService.getBranch(project.localPath),
        })),
      );
      return panel.webview.postMessage({
        type: "workspace.state",
        ...state,
        projects,
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
              await sendWorkspace();
              return;
            case "navigation.select":
              activePage = request.page;
              await sendState();
              if (activePage === "notes") await sendNotes();
              if (activePage === "workspace") await sendWorkspace();
              return;
            case "notes.refresh":
              await sendNotes(request.query);
              return;
            case "notes.create":
              await panel.webview.postMessage({
                type: "notes.created",
                id: await noteService.createNote(
                  request.title,
                  request.content,
                ),
              } satisfies ExtensionResponse);
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
            case "workspace.refresh":
              await sendWorkspace();
              return;
            case "projects.browse": {
              const selected = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: "Select project folder",
              });
              const folder = selected?.[0];
              if (folder)
                await panel.webview.postMessage({
                  type: "projects.pathSelected",
                  localPath: folder.fsPath,
                  name: basename(folder.fsPath),
                } satisfies ExtensionResponse);
              return;
            }
            case "commands.browse": {
              const selected = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: "Select terminal folder",
              });
              const folder = selected?.[0];
              if (folder) {
                selectedCommandPath = folder.fsPath;
                await panel.webview.postMessage({
                  type: "commands.pathSelected",
                  localPath: folder.fsPath,
                } satisfies ExtensionResponse);
              }
              return;
            }
            case "projects.create":
              await workspaceService.createProject(
                request.name,
                request.localPath,
                request.preferredIde,
              );
              break;
            case "projects.update":
              await workspaceService.updateProject(
                request.id as string,
                request.name,
                request.localPath,
                request.preferredIde,
              );
              break;
            case "projects.delete":
              await workspaceService.deleteProject(request.id);
              break;
            case "projects.favourite":
              await workspaceService.setFavourite(
                request.id,
                request.favourite,
              );
              break;
            case "projects.terminal":
              await commandExecutionService.openProjectTerminal(
                request.id,
                platform.defaultShell,
              );
              break;
            case "commands.create":
              if (
                request.workingDirectory &&
                request.workingDirectory !== selectedCommandPath
              )
                throw new Error("Command path was not selected by the user.");
              await workspaceService.createCommand(
                undefined,
                request.name,
                request.command,
                request.platform,
                platform.defaultShell,
                request.workingDirectory,
                "always",
              );
              selectedCommandPath = undefined;
              break;
            case "commands.delete":
              await workspaceService.deleteCommand(request.id);
              break;
            case "commands.execute":
              await commandExecutionService.execute(request.id);
              break;
            case "environments.create":
              await workspaceService.createEnvironment(
                request.projectId,
                request.name,
                request.description,
                request.variableNames,
              );
              break;
            case "environments.delete":
              await workspaceService.deleteEnvironment(request.id);
              break;
          }
          if (
            request.type.startsWith("notes.") ||
            request.type.startsWith("sticky.")
          )
            await sendNotes(noteQuery);
          else await sendWorkspace();
        } catch {
          await panel.webview.postMessage({
            type: "protocol.error",
            code: "operation_failed",
            message: "DevWorkspace could not complete the requested operation.",
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
