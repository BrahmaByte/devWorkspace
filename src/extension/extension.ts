import * as vscode from "vscode";
import { basename } from "node:path";

import { NoteService } from "../application/services/noteService";
import { ConfluenceService } from "../application/services/confluenceService";
import { CommandExecutionService } from "../application/services/commandExecutionService";
import { GitBranchService } from "../application/services/gitBranchService";
import { HomeService } from "../application/services/homeService";
import {
  ConfluenceCacheSearchProvider,
  JiraCacheSearchProvider,
  LocalSearchProvider,
  SearchService,
} from "../application/services/searchService";
import { SelectedPathAuthorizer } from "../application/services/pathAuthorizationService";
import {
  connectionErrorMessage,
  shouldOfferProxySettings,
} from "../application/services/integrationError";
import { JiraService } from "../application/services/jiraService";
import { isAtlassianCloud } from "../application/services/atlassianAuth";
import { WorkspaceService } from "../application/services/workspaceService";
import { UrlGroupService } from "../application/services/urlGroupService";
import { DeveloperApplicationService } from "../application/services/developerApplicationService";
import { prepareDatabasePath } from "../infrastructure/database/location";
import { LocalDatabase } from "../infrastructure/database/localDatabase";
import { NoteRepository } from "../infrastructure/database/noteRepository";
import { ConfluenceRepository } from "../infrastructure/database/confluenceRepository";
import { JiraRepository } from "../infrastructure/database/jiraRepository";
import { WorkspaceRepository } from "../infrastructure/database/workspaceRepository";
import { UrlGroupRepository } from "../infrastructure/database/urlGroupRepository";
import { DeveloperApplicationRepository } from "../infrastructure/database/developerApplicationRepository";
import { NodeGitRunner } from "../infrastructure/git/nodeGitRunner";
import { FetchJiraClientFactory } from "../infrastructure/jira/fetchJiraClient";
import { FetchConfluenceClientFactory } from "../infrastructure/confluence/fetchConfluenceClient";
import { VscodeHttpTransport } from "../infrastructure/http/vscodeHttpTransport";
import { createExtensionProxyFetch } from "../infrastructure/http/extensionProxy";
import { VscodeExtensionProxy } from "../infrastructure/vscode/vscodeExtensionProxy";
import {
  VscodeCommandExecutor,
  VscodeConfirmationGateway,
} from "../infrastructure/vscode/vscodeCommandExecutor";
import { VscodeProjectWorkspaceGateway } from "../infrastructure/vscode/vscodeProjectWorkspaceGateway";
import { createPlatformService } from "../platform/platformService";
import { NodeDeveloperApplicationProcessGateway } from "../platform/developerApplicationProcess";
import { DeveloperApplicationIconProvider } from "../platform/developerApplicationIcon";
import { createWebviewHtml } from "../webview/app/shell";
import type {
  ExtensionResponse,
  ShellPage,
} from "../webview/protocol/messages";
import { parseWebviewRequest } from "../webview/protocol/validation";

const OPEN_COMMAND = "devdashboardv1.open";
const SEARCH_COMMAND = "devdashboardv1.search";
const LEGACY_OPEN_COMMAND = "devworkspace.open";
const LEGACY_SEARCH_COMMAND = "devworkspace.search";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const database = await LocalDatabase.open(
    await prepareDatabasePath(context.globalStorageUri.fsPath),
  );
  const noteRepository = new NoteRepository(database);
  const noteService = new NoteService(noteRepository);
  const platform = createPlatformService();
  const workspaceRepository = new WorkspaceRepository(database);
  const workspaceService = new WorkspaceService(
    workspaceRepository,
    platform.operatingSystem,
  );
  const urlGroupRepository = new UrlGroupRepository(database);
  const urlGroupService = new UrlGroupService(urlGroupRepository);
  const developerApplicationService = new DeveloperApplicationService(
    new DeveloperApplicationRepository(database),
    new NodeDeveloperApplicationProcessGateway(platform.operatingSystem),
  );
  const developerApplicationIcons = new DeveloperApplicationIconProvider(
    platform.operatingSystem,
  );
  const homeService = new HomeService(
    noteRepository,
    urlGroupRepository,
    developerApplicationService,
  );
  const jiraRepository = new JiraRepository(database);
  const confluenceRepository = new ConfluenceRepository(database);
  const extensionProxy = new VscodeExtensionProxy(context.secrets);
  const httpTransport = new VscodeHttpTransport(
    createExtensionProxyFetch(
      () => extensionProxy.load(),
      globalThis.fetch.bind(globalThis),
    ),
  );
  const jiraService = new JiraService(
    jiraRepository,
    context.secrets,
    new FetchJiraClientFactory(httpTransport),
  );
  const confluenceService = new ConfluenceService(
    confluenceRepository,
    context.secrets,
    new FetchConfluenceClientFactory(httpTransport),
  );
  const searchService = new SearchService([
    new LocalSearchProvider(noteRepository, workspaceRepository),
    new JiraCacheSearchProvider(jiraRepository),
    new ConfluenceCacheSearchProvider(confluenceRepository),
  ]);
  const commandExecutionService = new CommandExecutionService(
    workspaceRepository,
    new VscodeCommandExecutor(),
    new VscodeConfirmationGateway(),
    platform.operatingSystem,
  );
  const gitBranchService = new GitBranchService(new NodeGitRunner());
  context.subscriptions.push({
    dispose: () => {
      developerApplicationService.dispose();
      database.close();
    },
  });

  const showDevDashboardV1 = (initialPage: ShellPage): void => {
    let activePage: ShellPage = initialPage;
    let noteQuery = "";
    let selectedCommandPath: string | undefined;
    const selectedProjectPaths = new SelectedPathAuthorizer();
    const panel = vscode.window.createWebviewPanel(
      "devdashboardv1.main",
      "DevDashboardV1",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "assets"),
        ],
        retainContextWhenHidden: false,
      },
    );

    const logoUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        context.extensionUri,
        "assets",
        "devdashboardv1-icon.png",
      ),
    );
    panel.webview.html = createWebviewHtml(
      panel.webview.cspSource,
      logoUri.toString(),
    );

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
    const sendHome = async (): Promise<boolean> => {
      const state = homeService.getState();
      return panel.webview.postMessage({
        type: "home.state",
        state: {
          ...state,
          developerApplications: await Promise.all(
            state.developerApplications.map(async (application) => ({
              ...application,
              iconDataUrl: await developerApplicationIcons.getIcon(
                developerApplicationService.getIconSource(application.id),
              ),
            })),
          ),
        },
      } satisfies ExtensionResponse);
    };
    const appChangeSubscription = developerApplicationService.onDidChange(
      () => {
        void sendHome();
      },
    );
    const sendJira = async (): Promise<boolean> =>
      panel.webview.postMessage({
        type: "jira.state",
        state: await jiraService.refresh(),
      } satisfies ExtensionResponse);
    const sendConfluence = async (): Promise<boolean> =>
      panel.webview.postMessage({
        type: "confluence.state",
        state: await confluenceService.refresh(),
      } satisfies ExtensionResponse);
    const sendSearch = (query = ""): Thenable<boolean> =>
      panel.webview.postMessage({
        type: "search.state",
        state: searchService.search(query),
      } satisfies ExtensionResponse);

    const pendingCommentConfirmations = new Set<string>();
    const messageSubscription = panel.webview.onDidReceiveMessage(
      async (message: unknown) => {
        const parsed = parseWebviewRequest(message);
        if (!parsed.ok) {
          await panel.webview.postMessage({
            type: "protocol.error",
            code: "invalid_message",
            message: "DevDashboardV1 rejected an invalid Webview message.",
          } satisfies ExtensionResponse);
          return;
        }
        const request = parsed.value;
        try {
          switch (request.type) {
            case "network.configure":
              await extensionProxy.configure();
              return;
            case "shell.ready":
              await sendState();
              await sendNotes();
              await sendWorkspace();
              await sendHome();
              await sendJira();
              await sendConfluence();
              if (activePage === "search") await sendSearch();
              return;
            case "home.refresh":
              await sendHome();
              return;
            case "home.search":
              activePage = "notes";
              await sendState();
              await sendNotes(request.query);
              return;
            case "urls.create":
              await urlGroupService.create(request.name, request.urls);
              await sendHome();
              return;
            case "urls.delete":
              await urlGroupService.delete(request.id);
              await sendHome();
              return;
            case "urls.open":
              await vscode.env.openExternal(
                vscode.Uri.parse(
                  urlGroupService.getUrl(request.id, request.index),
                ),
              );
              return;
            case "urls.openAll":
              for (const url of urlGroupService.getUrls(request.id))
                await vscode.env.openExternal(vscode.Uri.parse(url));
              return;
            case "apps.browse": {
              const selected = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: platform.operatingSystem === "macos",
                canSelectMany: false,
                openLabel: "Add developer application",
                title: "Select an application executable",
              });
              const application = selected?.[0];
              if (!application) return;
              await developerApplicationService.add(application.fsPath);
              await sendHome();
              return;
            }
            case "apps.launch":
              await developerApplicationService.launch(request.id);
              await sendHome();
              return;
            case "apps.close": {
              const confirmed = await vscode.window.showWarningMessage(
                "Close this application? Unsaved work in the application may be lost.",
                { modal: true },
                "Close application",
              );
              if (confirmed !== "Close application") return;
              await developerApplicationService.close(request.id);
              await sendHome();
              return;
            }
            case "apps.delete":
              await developerApplicationService.delete(request.id);
              await sendHome();
              return;
            case "search.query":
              await sendSearch(request.query);
              return;
            case "search.open":
              if (request.resultType === "note") {
                activePage = "notes";
                await sendState();
                await sendNotes();
                await panel.webview.postMessage({
                  type: "search.note",
                  id: request.id,
                } satisfies ExtensionResponse);
              } else if (request.resultType === "project") {
                const project = workspaceRepository.getProject(request.id);
                if (!project) throw new Error("Project was not found.");
                await new VscodeProjectWorkspaceGateway().openProject(
                  project.localPath,
                );
              } else if (request.resultType === "command") {
                await commandExecutionService.execute(request.id);
              } else if (request.resultType === "jira_issue") {
                await vscode.env.openExternal(
                  vscode.Uri.parse(jiraService.getIssueUrl(request.id)),
                );
              } else {
                await vscode.env.openExternal(
                  vscode.Uri.parse(confluenceService.getPageUrl(request.id)),
                );
              }
              return;
            case "confluence.connect": {
              const cloud = isAtlassianCloud(request.baseUrl);
              const email = cloud
                ? await vscode.window.showInputBox({
                    title: "Connect Confluence Cloud",
                    prompt: "Enter your Atlassian account email",
                    ignoreFocusOut: true,
                    validateInput: (value) =>
                      /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim())
                        ? undefined
                        : "Enter a valid email address.",
                  })
                : undefined;
              if (cloud && email === undefined) return;
              const token = await vscode.window.showInputBox({
                title: "Connect Confluence",
                prompt: cloud
                  ? "Enter your Atlassian API token"
                  : "Enter a Confluence personal access token",
                password: true,
                ignoreFocusOut: true,
              });
              if (token === undefined) return;
              await panel.webview.postMessage({
                type: "confluence.state",
                state: await confluenceService.connect(
                  request.displayName,
                  request.baseUrl,
                  token,
                  email,
                ),
              } satisfies ExtensionResponse);
              return;
            }
            case "confluence.refresh":
              confluenceService.clearReaderCache();
              await sendConfluence();
              return;
            case "confluence.disconnect":
              await confluenceService.disconnect();
              await sendConfluence();
              return;
            case "confluence.search":
              await panel.webview.postMessage({
                type: "confluence.state",
                state: await confluenceService.search(request.query),
              } satisfies ExtensionResponse);
              return;
            case "confluence.open":
              await vscode.env.openExternal(
                vscode.Uri.parse(confluenceService.getPageUrl(request.id)),
              );
              return;
            case "confluence.reader":
            case "confluence.preview":
              try {
                await panel.webview.postMessage({
                  type: request.type,
                  document: await confluenceService.readPage(request.id),
                } satisfies ExtensionResponse);
              } catch (error) {
                await panel.webview.postMessage({
                  type: "confluence.readError",
                  id: request.id,
                  target:
                    request.type === "confluence.preview"
                      ? "preview"
                      : "reader",
                  message: connectionErrorMessage("confluence", error),
                } satisfies ExtensionResponse);
              }
              return;
            case "confluence.bookmark": {
              const page = confluenceService.getPage(request.id);
              const content = [
                "CONFLUENCE REFERENCE BOOKMARK",
                "",
                "This note is a local reference bookmark to a Confluence page.",
                "",
                `Document ID: ${page.id}`,
                ...(page.spaceName ? [`Space: ${page.spaceName}`] : []),
                `URL: ${page.webUrl}`,
              ].join("\n");
              const noteId = await noteService.createNote(page.title, content);
              activePage = "notes";
              await panel.webview.postMessage({
                type: "confluence.bookmarked",
                noteId,
              } satisfies ExtensionResponse);
              await sendState();
              await sendNotes();
              return;
            }
            case "jira.connect": {
              const cloud = isAtlassianCloud(request.baseUrl);
              const email = cloud
                ? await vscode.window.showInputBox({
                    title: "Connect Jira Cloud",
                    prompt: "Enter your Atlassian account email",
                    ignoreFocusOut: true,
                    validateInput: (value) =>
                      /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim())
                        ? undefined
                        : "Enter a valid email address.",
                  })
                : undefined;
              if (cloud && email === undefined) return;
              const token = await vscode.window.showInputBox({
                title: "Connect Jira",
                prompt: cloud
                  ? "Enter your Atlassian API token"
                  : "Enter a Jira personal access token",
                password: true,
                ignoreFocusOut: true,
              });
              if (token === undefined) return;
              await panel.webview.postMessage({
                type: "jira.state",
                state: await jiraService.connect(
                  request.displayName,
                  request.baseUrl,
                  token,
                  email,
                ),
              } satisfies ExtensionResponse);
              return;
            }
            case "jira.refresh":
              await sendJira();
              return;
            case "jira.disconnect":
              await jiraService.disconnect();
              await sendJira();
              return;
            case "jira.issue":
              try {
                await panel.webview.postMessage({
                  type: "jira.issue",
                  issue: await jiraService.getIssue(request.issueKey),
                } satisfies ExtensionResponse);
              } catch {
                await panel.webview.postMessage({
                  type: "jira.viewer.error",
                  issueKey: request.issueKey,
                  target: "issue",
                  message:
                    "Could not load this issue. Check Jira connection and Browse Projects permissions.",
                } satisfies ExtensionResponse);
              }
              return;
            case "jira.comments":
              try {
                await panel.webview.postMessage({
                  type: "jira.comments",
                  issueKey: request.issueKey,
                  startAt: request.startAt,
                  page: await jiraService.getComments(
                    request.issueKey,
                    request.startAt,
                  ),
                } satisfies ExtensionResponse);
              } catch {
                await panel.webview.postMessage({
                  type: "jira.viewer.error",
                  issueKey: request.issueKey,
                  target: "comments",
                  message:
                    "Could not load comments. Check the connection and issue permissions.",
                } satisfies ExtensionResponse);
              }
              return;
            case "jira.comment.add": {
              if (pendingCommentConfirmations.has(request.issueKey)) return;
              pendingCommentConfirmations.add(request.issueKey);
              try {
                const confirmed = await vscode.window.showInformationMessage(
                  `Post a comment to ${request.issueKey}? It will be visible to people with access to this Jira issue.`,
                  { modal: true },
                  "Post comment",
                );
                if (confirmed !== "Post comment") {
                  await panel.webview.postMessage({
                    type: "jira.comment.result",
                    issueKey: request.issueKey,
                    message: "Posting cancelled.",
                  } satisfies ExtensionResponse);
                  return;
                }
                try {
                  await panel.webview.postMessage({
                    type: "jira.comment.result",
                    issueKey: request.issueKey,
                    comment: await jiraService.addComment(
                      request.issueKey,
                      request.body,
                    ),
                  } satisfies ExtensionResponse);
                } catch {
                  await panel.webview.postMessage({
                    type: "jira.comment.result",
                    issueKey: request.issueKey,
                    message:
                      "Could not confirm posting. Check the Jira thread before retrying, and verify Add Comments permissions.",
                  } satisfies ExtensionResponse);
                }
                return;
              } finally {
                pendingCommentConfirmations.delete(request.issueKey);
              }
            }
            case "jira.open":
              await vscode.env.openExternal(
                vscode.Uri.parse(jiraService.getIssueUrl(request.issueKey)),
              );
              return;
            case "jira.search":
              await panel.webview.postMessage({
                type: "jira.state",
                state: await jiraService.search(request.query),
              } satisfies ExtensionResponse);
              return;
            case "jira.local.create":
              await jiraService.createLocalCard(
                request.summary,
                request.status,
              );
              await sendJira();
              return;
            case "jira.local.move":
              await jiraService.moveLocalCard(request.id, request.status);
              await sendJira();
              return;
            case "jira.local.delete":
              await jiraService.deleteLocalCard(request.id);
              await sendJira();
              return;
            case "navigation.select":
              activePage = request.page;
              await sendState();
              if (activePage === "notes") await sendNotes();
              if (activePage === "workspace") await sendWorkspace();
              if (activePage === "home") await sendHome();
              if (activePage === "jira" || activePage === "settings")
                await sendJira();
              if (activePage === "knowledge" || activePage === "settings")
                await sendConfluence();
              if (activePage === "search") await sendSearch();
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
              if (folder) {
                selectedProjectPaths.authorize(folder.fsPath);
                await panel.webview.postMessage({
                  type: "projects.pathSelected",
                  localPath: folder.fsPath,
                  name: basename(folder.fsPath),
                } satisfies ExtensionResponse);
              }
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
              if (!selectedProjectPaths.consume(request.localPath))
                throw new Error("Project path was not selected by the user.");
              await workspaceService.createProject(
                request.name,
                request.localPath,
              );
              break;
            case "projects.update":
              if (
                workspaceRepository.getProject(request.id as string)
                  ?.localPath !== request.localPath &&
                !selectedProjectPaths.consume(request.localPath)
              )
                throw new Error("Project path was not selected by the user.");
              await workspaceService.updateProject(
                request.id as string,
                request.name,
                request.localPath,
              );
              break;
            case "projects.delete":
              await workspaceService.deleteProject(request.id);
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
                platform.operatingSystem,
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
          await sendHome();
        } catch (error) {
          if (request.type.startsWith("apps.")) {
            const message =
              request.type === "apps.browse"
                ? "DevDashboardV1 could not add that application. Select a local executable application that you are allowed to run."
                : request.type === "apps.launch"
                  ? "DevDashboardV1 could not launch that application. Confirm it still exists and is executable."
                  : request.type === "apps.close"
                    ? "DevDashboardV1 could not close that application. Save your work and close it from the application."
                    : "DevDashboardV1 could not remove that application. Close it first if it is running.";
            await vscode.window.showErrorMessage(message);
            await panel.webview.postMessage({
              type: "protocol.error",
              code: "operation_failed",
              message,
            } satisfies ExtensionResponse);
            return;
          }
          if (
            request.type === "jira.connect" ||
            request.type === "confluence.connect"
          ) {
            const provider = request.type.startsWith("jira")
              ? "jira"
              : "confluence";
            const message = connectionErrorMessage(provider, error);
            await panel.webview.postMessage({
              type: "integration.error",
              provider,
              message,
            } satisfies ExtensionResponse);
            if (shouldOfferProxySettings(error)) {
              const action = await vscode.window.showErrorMessage(
                message,
                "Open Proxy Settings",
                "Extension-only Proxy",
              );
              if (action === "Open Proxy Settings")
                await vscode.commands.executeCommand(
                  "workbench.action.openSettings",
                  "proxy",
                );
              if (action === "Extension-only Proxy")
                await extensionProxy.configure();
            }
            return;
          }
          await panel.webview.postMessage({
            type: "protocol.error",
            code: "operation_failed",
            message:
              "DevDashboardV1 could not complete the requested operation.",
          } satisfies ExtensionResponse);
        }
      },
    );

    panel.onDidDispose(() => {
      messageSubscription.dispose();
      appChangeSubscription.dispose();
    });
  };

  const openDevDashboardV1 = vscode.commands.registerCommand(OPEN_COMMAND, () =>
    showDevDashboardV1("home"),
  );
  const openSearch = vscode.commands.registerCommand(SEARCH_COMMAND, () =>
    showDevDashboardV1("search"),
  );
  const openLegacyDevWorkspace = vscode.commands.registerCommand(
    LEGACY_OPEN_COMMAND,
    () => showDevDashboardV1("home"),
  );
  const openLegacySearch = vscode.commands.registerCommand(
    LEGACY_SEARCH_COMMAND,
    () => showDevDashboardV1("search"),
  );

  context.subscriptions.push(
    openDevDashboardV1,
    openSearch,
    openLegacyDevWorkspace,
    openLegacySearch,
  );
}

export function deactivate(): void {
  // No resources survive extension deactivation in the scaffold.
}
