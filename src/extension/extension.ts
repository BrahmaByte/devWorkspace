import * as vscode from "vscode";
import { basename } from "node:path";

import { NoteService } from "../application/services/noteService";
import { CalendarService } from "../application/services/calendarService";
import { TeamCalendarService } from "../application/services/teamCalendarService";
import { TeamCalendarError, teamCalendarUrl } from "../domain/calendar";
import {
  GitHubService,
  GitHubError,
} from "../application/services/githubService";
import type { GitHubState } from "../domain/github";
import { VscodeGitHubClone } from "../infrastructure/vscode/vscodeGitHubClone";
import { CalendarRepository } from "../infrastructure/database/calendarRepository";
import {
  walkthroughMode,
  walkthroughVersionKey,
} from "../application/services/walkthrough";
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
import { jiraQuickFilters } from "../domain/jira/models";
import { isAtlassianCloud } from "../application/services/atlassianAuth";
import { WorkspaceService } from "../application/services/workspaceService";
import { UrlGroupService } from "../application/services/urlGroupService";
import { DeveloperApplicationService } from "../application/services/developerApplicationService";
import { prepareDatabasePath } from "../infrastructure/database/location";
import { LocalDatabase } from "../infrastructure/database/localDatabase";
import {
  UserEnvironment,
  UserEnvironmentError,
  validateEnvironmentName,
} from "../platform/userEnvironment";
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
const GUIDE_COMMAND = "devdashboardv1.guide";
const SNAPSHOT_COMMAND = "devdashboardv1.database.snapshot";
const RESTORE_COMMAND = "devdashboardv1.database.restore";
const LEGACY_OPEN_COMMAND = "devworkspace.open";
const LEGACY_SEARCH_COMMAND = "devworkspace.search";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const version = (
    context.extension.packageJSON as { readonly version: string }
  ).version;
  let walkthroughShown = false;
  let panelOpened = false;
  const databasePath = await prepareDatabasePath(
    context.globalStorageUri.fsPath,
  );
  const selectRestore = async (): Promise<string | undefined> => {
    const snapshots = await LocalDatabase.listSnapshots(databasePath);
    if (!snapshots.length) {
      await vscode.window.showWarningMessage(
        "No local database snapshots are available.",
      );
      return undefined;
    }
    const selected = await vscode.window.showQuickPick(
      snapshots.map((snapshot) => ({
        label: new Date(snapshot.createdAt).toLocaleString(),
        description: snapshot.kind,
        name: snapshot.name,
      })),
      {
        title: "Restore a local database snapshot",
        placeHolder: "Most recent snapshots first",
      },
    );
    if (!selected) return undefined;
    const confirmed = await vscode.window.showWarningMessage(
      "Restore this snapshot and reload VS Code? Close other VS Code windows using DevDashboardV1 first. Current local data will be replaced after validation; a pre-restore copy will be saved. Credentials and VS Code settings are not restored.",
      { modal: true },
      "Restore and reload",
    );
    return confirmed === "Restore and reload" ? selected.name : undefined;
  };
  let database: LocalDatabase;
  try {
    database = await LocalDatabase.open(databasePath);
  } catch (error) {
    const action = await vscode.window.showErrorMessage(
      "DevDashboardV1 could not open its database. The existing file has not been replaced. You can select a validated local snapshot to recover your data.",
      "Restore snapshot",
    );
    if (!action) throw error;
    const selected = await selectRestore();
    if (!selected) throw error;
    try {
      await LocalDatabase.restoreFile(databasePath, selected);
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
      return;
    } catch {
      await vscode.window.showErrorMessage(
        "Snapshot recovery failed. The current database is retained if validation failed. Check file permissions, available disk space and snapshot compatibility.",
      );
      throw error;
    }
  }
  const noteRepository = new NoteRepository(database);
  const noteService = new NoteService(noteRepository);
  const calendarRepository = new CalendarRepository(database);
  const platform = createPlatformService();
  const projectWorkspace = new VscodeProjectWorkspaceGateway(
    context.globalState,
    platform.operatingSystem,
  );
  const userEnvironment = new UserEnvironment(platform.operatingSystem);
  let environmentEditPending = false;
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
  const networkOutput = vscode.window.createOutputChannel(
    "DevDashboardV1 Network",
  );
  context.subscriptions.push(networkOutput);
  networkOutput.appendLine(
    "Network diagnostics: retry Jira connection/sync, Confluence connection/refresh or GitHub connection/refresh. URLs, headers, credentials, content and raw errors are never logged.",
  );
  const httpTransport = new VscodeHttpTransport(
    createExtensionProxyFetch(
      async () => {
        const config = await extensionProxy.load();
        if (!config) {
          const http = vscode.workspace.getConfiguration("http");
          networkOutput.appendLine(
            `${new Date().toISOString()} VS Code networking: extension proxy support enabled=${http.get("proxySupport", "off") !== "off"}; additional fetch support enabled=${http.get("fetchAdditionalSupport", true) === true}; system certificates enabled=${http.get("systemCertificates", true) === true}. Proxy addresses and authentication data omitted.`,
          );
        }
        return config;
      },
      globalThis.fetch.bind(globalThis),
      (message) =>
        networkOutput.appendLine(`${new Date().toISOString()} ${message}`),
    ),
  );
  const githubService = new GitHubService(context.secrets, httpTransport);
  const githubClone = new VscodeGitHubClone(context.secrets);
  // ponytail: one GitHub operation per host; split locks only if concurrent clones are needed.
  let githubOperationPending = false;
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
  const teamCalendars = new TeamCalendarService(
    calendarRepository,
    context.secrets,
    confluenceService,
  );
  const calendarService = new CalendarService(
    calendarRepository,
    (year) => teamCalendars.entries(year),
    () => teamCalendars.sources(),
  );
  let dashboardPanel: vscode.WebviewPanel | undefined;
  context.subscriptions.push(
    context.secrets.onDidChange((event) => {
      if (event.key.startsWith("devworkspace.confluence.")) {
        teamCalendars.clear();
        void dashboardPanel?.webview.postMessage({
          type: "calendar.invalidated",
        } satisfies ExtensionResponse);
      }
    }),
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

  const showDevDashboardV1 = (
    initialPage: ShellPage,
    replayGuide = false,
  ): void => {
    panelOpened = true;
    let replayPending = replayGuide;
    let activePage: ShellPage = initialPage;
    let confluenceSearchSequence = 0;
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
    dashboardPanel = panel;

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
    const sendIdeState = (): Thenable<boolean> =>
      panel.webview.postMessage({
        type: "ide.state",
        ides: projectWorkspace.ides(),
      } satisfies ExtensionResponse);
    const sendHome = async (refreshRecent = false): Promise<boolean> => {
      if (refreshRecent) await sendHome();
      const recent = await jiraService.getRecentIssues(refreshRecent);
      const state = homeService.getState();
      return panel.webview.postMessage({
        type: "home.state",
        state: {
          ...state,
          recentJiraIssues: recent.issues,
          recentJiraMessage: recent.message,
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
            case "calendar.refresh":
            case "calendar.save":
            case "calendar.delete":
            case "calendar.type.save":
            case "calendar.type.delete":
              try {
                if (request.type === "calendar.save")
                  await calendarService.save(request.entry);
                if (request.type === "calendar.type.save")
                  await calendarService.saveType(request.leaveType);
                if (
                  request.type === "calendar.delete" ||
                  request.type === "calendar.type.delete"
                ) {
                  const choice = await vscode.window.showWarningMessage(
                    "Delete this local calendar item?",
                    { modal: true },
                    "Delete",
                  );
                  if (choice !== "Delete") {
                    await panel.webview.postMessage({
                      type: "calendar.error",
                      message: "Deletion cancelled.",
                    } satisfies ExtensionResponse);
                    return;
                  }
                  if (request.type === "calendar.delete")
                    await calendarService.delete(request.id);
                  else await calendarService.deleteType(request.id);
                }
                await panel.webview.postMessage({
                  type:
                    request.type === "calendar.refresh"
                      ? "calendar.state"
                      : "calendar.saved",
                  state: calendarService.getState(request.year),
                } satisfies ExtensionResponse);
              } catch (error) {
                await panel.webview.postMessage({
                  type: "calendar.error",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Calendar operation failed. Your draft is retained.",
                } satisfies ExtensionResponse);
              }
              return;
            case "calendar.source.connect":
            case "calendar.source.refresh":
            case "calendar.source.remove":
            case "calendar.source.event": {
              try {
                if (request.type === "calendar.source.connect") {
                  const site = confluenceService.calendarSite();
                  const url = await vscode.window.showInputBox({
                    title: "Connect Confluence Team Calendar",
                    prompt:
                      "Paste Subscribe → iCal URL. Private links are credentials: stored only in SecretStorage.",
                    password: true,
                    ignoreFocusOut: true,
                    validateInput: (value) => {
                      try {
                        teamCalendarUrl(site, value);
                        return undefined;
                      } catch {
                        return "Use the iCal subscription URL from the connected Confluence site.";
                      }
                    },
                  });
                  if (url === undefined)
                    throw new TeamCalendarError(
                      "Calendar connection cancelled.",
                    );
                  const choice = await vscode.window.showInformationMessage(
                    "Connect this read-only calendar? Events will be loaded for the selected year and held only for this session. No events or leave requests are sent to Confluence.",
                    { modal: true },
                    "Connect",
                  );
                  if (choice !== "Connect")
                    throw new TeamCalendarError(
                      "Calendar connection cancelled.",
                    );
                  await teamCalendars.connect(
                    request.name,
                    url,
                    request.color,
                    request.holidays,
                    request.year,
                  );
                } else if (request.type === "calendar.source.refresh") {
                  await teamCalendars.refresh(request.id, request.year);
                } else if (request.type === "calendar.source.remove") {
                  const choice = await vscode.window.showWarningMessage(
                    "Remove this calendar connection and its private subscription link? Local plans and leave remain unchanged.",
                    { modal: true },
                    "Remove",
                  );
                  if (choice !== "Remove")
                    throw new TeamCalendarError("Calendar removal cancelled.");
                  await teamCalendars.remove(request.id);
                } else {
                  const entry = teamCalendars
                    .entries(request.year)
                    .find((item) => item.id === request.id);
                  if (!entry)
                    throw new TeamCalendarError(
                      "Refresh the calendar before viewing this event.",
                    );
                  await vscode.window.showInformationMessage(entry.title, {
                    modal: true,
                    detail: `${entry.sourceName} · Read-only\n${entry.startDate} ${entry.startTime} – ${entry.endDate} ${entry.endTime}\n\n${entry.agenda}`,
                  });
                  return;
                }
                await panel.webview.postMessage({
                  type: "calendar.sources",
                  sources: teamCalendars.sources(),
                  message:
                    request.type === "calendar.source.remove"
                      ? "Calendar removed."
                      : "Calendar refreshed. Imported events are read-only.",
                } satisfies ExtensionResponse);
                await panel.webview.postMessage({
                  type: "calendar.saved",
                  state: calendarService.getState(request.year),
                } satisfies ExtensionResponse);
              } catch (error) {
                const message =
                  error instanceof TeamCalendarError
                    ? error.message
                    : connectionErrorMessage("confluence", error);
                await panel.webview.postMessage({
                  type: "calendar.sources",
                  sources: teamCalendars.sources(),
                  message,
                  error: true,
                } satisfies ExtensionResponse);
                await panel.webview.postMessage({
                  type: "calendar.error",
                  message,
                } satisfies ExtensionResponse);
              }
              return;
            }
            case "github.status":
              await panel.webview.postMessage({
                type: "github.state",
                state: await githubService.state(),
              } satisfies ExtensionResponse);
              return;
            case "github.configure":
            case "github.disconnect":
            case "github.refresh":
            case "github.repositories":
            case "github.clone": {
              if (githubOperationPending) {
                await panel.webview.postMessage({
                  type: "github.state",
                  state: await githubService.state(
                    "A GitHub operation is already running.",
                  ),
                } satisfies ExtensionResponse);
                return;
              }
              githubOperationPending = true;
              try {
                if (request.type === "github.configure") {
                  const token = await vscode.window.showInputBox({
                    title: "Connect GitHub.com",
                    prompt:
                      "GitHub PAT: grant read access to repository metadata and contents for private clones. Organization access may require SSO/admin approval. The PAT is stored only in VS Code SecretStorage.",
                    password: true,
                    ignoreFocusOut: true,
                    validateInput: (value) =>
                      !value.trim() || value.length > 1024 || /\s/u.test(value)
                        ? "Enter a PAT without whitespace."
                        : undefined,
                  });
                  if (token) {
                    await githubService.connect(token);
                    await githubService.refresh();
                  }
                } else if (request.type === "github.disconnect") {
                  if (
                    (await vscode.window.showWarningMessage(
                      "Disconnect GitHub and remove its saved PAT? Local clones and projects will remain.",
                      { modal: true },
                      "Disconnect",
                    )) === "Disconnect"
                  )
                    await githubService.disconnect();
                } else if (request.type === "github.refresh") {
                  await githubService.refresh();
                } else if (request.type === "github.repositories") {
                  await panel.webview.postMessage({
                    type: "github.state",
                    state: await githubService.browse(
                      request.owner,
                      request.more,
                    ),
                  } satisfies ExtensionResponse);
                  return;
                } else {
                  if (request.type !== "github.clone") return;
                  const repo = await githubService.repository(request.id);
                  const localPath = await githubClone.clone(repo);
                  if (localPath) {
                    if (
                      !workspaceRepository
                        .getState()
                        .projects.some(
                          (project) => project.localPath === localPath,
                        )
                    )
                      await workspaceService.createProject(
                        repo.name,
                        localPath,
                      );
                    await sendWorkspace();
                    await vscode.window.showInformationMessage(
                      "Cloned repository added to Project launcher.",
                    );
                  }
                }
                await panel.webview.postMessage({
                  type: "github.state",
                  state: await githubService.state(),
                } satisfies ExtensionResponse);
              } catch (error) {
                const message =
                  error instanceof GitHubError
                    ? error.message
                    : "GitHub operation could not finish. Check VS Code Git and network settings. No automatic retry was attempted.";
                let state: GitHubState;
                try {
                  state = await githubService.state(message);
                } catch {
                  state = {
                    connected: false,
                    login: "",
                    organizations: [],
                    owner: "",
                    repositories: [],
                    hasMore: false,
                    message,
                  };
                }
                await panel.webview.postMessage({
                  type: "github.state",
                  state,
                } satisfies ExtensionResponse);
                await vscode.window.showErrorMessage(message);
              } finally {
                githubOperationPending = false;
              }
              return;
            }
            case "network.configure":
              await extensionProxy.configure();
              confluenceSearchSequence++;
              confluenceService.clearReaderCache();
              teamCalendars.clear();
              await panel.webview.postMessage({
                type: "calendar.invalidated",
              } satisfies ExtensionResponse);
              return;
            case "walkthrough.open":
              await panel.webview.postMessage({
                type: "walkthrough.state",
                mode: "tour",
                version,
              } satisfies ExtensionResponse);
              return;
            case "shell.ready":
              await sendState();
              await sendIdeState();
              await panel.webview.postMessage({
                type: "calendar.sources",
                sources: teamCalendars.sources(),
              } satisfies ExtensionResponse);
              {
                const mode = replayPending
                  ? "tour"
                  : walkthroughShown
                    ? undefined
                    : walkthroughMode(
                        context.globalState.get<string>(walkthroughVersionKey),
                        version,
                      );
                replayPending = false;
                if (mode) {
                  walkthroughShown = true;
                  await context.globalState.update(
                    walkthroughVersionKey,
                    version,
                  );
                  await panel.webview.postMessage({
                    type: "walkthrough.state",
                    mode,
                    version,
                  } satisfies ExtensionResponse);
                }
              }
              await sendNotes();
              await sendWorkspace();
              void sendHome(true);
              await sendJira();
              await sendConfluence();
              if (activePage === "search") await sendSearch();
              return;
            case "home.refresh":
              await sendHome(true);
              return;
            case "home.search":
              activePage = "notes";
              await sendState();
              await sendNotes(request.query);
              return;
            case "urls.create":
              await urlGroupService.create(request.name, request.urls);
              await panel.webview.postMessage({
                type: "urls.saved",
              } satisfies ExtensionResponse);
              await sendHome();
              return;
            case "urls.update":
              await urlGroupService.update(
                request.id,
                request.name,
                request.urls,
              );
              await panel.webview.postMessage({
                type: "urls.saved",
              } satisfies ExtensionResponse);
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
                await projectWorkspace.openProject(project.localPath);
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
              confluenceSearchSequence++;
              confluenceService.clearReaderCache();
              await sendConfluence();
              return;
            case "confluence.disconnect":
              confluenceSearchSequence++;
              await confluenceService.disconnect();
              await sendConfluence();
              return;
            case "confluence.search": {
              const sequence = ++confluenceSearchSequence;
              try {
                const state = await confluenceService.search(request.query);
                if (sequence !== confluenceSearchSequence) return;
                await panel.webview.postMessage({
                  type: "confluence.state",
                  state,
                } satisfies ExtensionResponse);
              } catch (error) {
                if (sequence !== confluenceSearchSequence) return;
                throw error;
              }
              return;
            }
            case "confluence.open":
              try {
                const opened = await vscode.env.openExternal(
                  vscode.Uri.parse(
                    confluenceService.getPageUrl(
                      request.id,
                      request.noteId
                        ? noteRepository.get(request.noteId)
                        : undefined,
                    ),
                  ),
                );
                if (!opened)
                  await vscode.window.showWarningMessage(
                    "Confluence could not open the default browser. Check your browser configuration.",
                  );
              } catch (error) {
                await vscode.window.showErrorMessage(
                  connectionErrorMessage("confluence", error),
                );
              }
              return;
            case "confluence.reader":
            case "confluence.preview":
              try {
                const responseType = request.type;
                await panel.webview.postMessage({
                  type: request.type,
                  document: await confluenceService.readPage(
                    request.id,
                    (document) => {
                      void panel.webview.postMessage({
                        type: responseType,
                        document,
                      } satisfies ExtensionResponse);
                    },
                    request.noteId
                      ? noteRepository.get(request.noteId)
                      : undefined,
                  ),
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
              await sendHome(true);
              return;
            }
            case "jira.refresh":
              await sendJira();
              await sendHome(true);
              return;
            case "jira.disconnect":
              await jiraService.disconnect();
              await sendJira();
              await sendHome();
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
            case "jira.filters":
              try {
                await panel.webview.postMessage({
                  type: "jira.filters",
                  filters: await jiraService.getSavedFilters(),
                } satisfies ExtensionResponse);
              } catch (error) {
                await panel.webview.postMessage({
                  type: "jira.filters",
                  filters: [],
                  message:
                    typeof error === "object" &&
                    error !== null &&
                    "status" in error &&
                    error.status === 401
                      ? "Jira credentials were rejected. Reconnect Jira in Settings."
                      : typeof error === "object" &&
                          error !== null &&
                          "status" in error &&
                          error.status === 403
                        ? "Jira denied access to saved filters. Check filter permissions."
                        : "Saved filters could not load. Check the Jira connection and network in Settings.",
                } satisfies ExtensionResponse);
              }
              return;
            case "jira.preset":
              await panel.webview.postMessage({
                type: "jira.state",
                state: await jiraService.search(
                  jiraQuickFilters[request.preset],
                ),
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
              if (activePage === "settings")
                await panel.webview.postMessage({
                  type: "calendar.sources",
                  sources: teamCalendars.sources(),
                } satisfies ExtensionResponse);
              if (activePage === "settings") await sendIdeState();
              if (activePage === "notes") await sendNotes();
              if (activePage === "workspace") await sendWorkspace();
              if (activePage === "home") await sendHome(true);
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
            case "ide.configure":
              await projectWorkspace.configure();
              await sendIdeState();
              return;
            case "ide.remove":
              await projectWorkspace.remove(request.id);
              await sendIdeState();
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
            case "projects.open": {
              const project = workspaceRepository.getProject(request.id);
              if (!project) throw new Error("Project was not found.");
              await projectWorkspace.openProject(project.localPath);
              return;
            }
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
            case "environment.search": {
              const names = vscode.workspace.isTrusted
                ? await userEnvironment.search(request.query)
                : [];
              await panel.webview.postMessage({
                type: "environment.results",
                query: request.query,
                names,
                ...(!vscode.workspace.isTrusted
                  ? {
                      message:
                        "Trust this workspace before searching your user environment.",
                    }
                  : {}),
              } satisfies ExtensionResponse);
              return;
            }
            case "environment.configure": {
              if (!vscode.workspace.isTrusted) {
                await vscode.window.showWarningMessage(
                  "Trust this workspace before editing your OS user environment.",
                );
                return;
              }
              if (environmentEditPending) return;
              environmentEditPending = true;
              try {
                const name = await vscode.window.showInputBox({
                  title: "Persistent user environment",
                  value: request.name,
                  prompt:
                    "Non-secret variable name. User scope only; no administrator access.",
                  ignoreFocusOut: true,
                  validateInput: (value) => {
                    try {
                      validateEnvironmentName(value);
                      return undefined;
                    } catch {
                      return "Use a non-secret name; startup/security hooks are blocked.";
                    }
                  },
                });
                if (name === undefined) return;
                validateEnvironmentName(name);
                const choice = await vscode.window.showQuickPick(
                  [
                    { label: "Overwrite", mode: "overwrite" as const },
                    { label: "Append", mode: "append" as const },
                  ],
                  {
                    title: "How should the user environment variable change?",
                    ignoreFocusOut: true,
                  },
                );
                if (!choice) return;
                const value = await vscode.window.showInputBox({
                  title: "Environment value (not a secret)",
                  password: true,
                  ignoreFocusOut: true,
                  prompt:
                    "OS environment values are plaintext. Do not enter tokens or passwords. Append preserves exact text; PATH adds the OS delimiter automatically.",
                  validateInput: (value) =>
                    !value.length ||
                    value.length > 16000 ||
                    /[\r\n\0]/u.test(value)
                      ? "Enter a non-empty single-line value (maximum 16000 characters)."
                      : undefined,
                });
                if (value === undefined) return;
                const change = await userEnvironment.prepare(
                  name,
                  value,
                  choice.mode,
                );
                const approved = await vscode.window.showWarningMessage(
                  `${choice.label} ${name} permanently in ${change.location}? OS environment values are plaintext. Existing processes are not updated. PATH changes affect which programs run. No system-wide settings or credentials are changed.`,
                  { modal: true },
                  "Save user environment",
                );
                if (approved !== "Save user environment") return;
                await change.commit();
                await vscode.window.showInformationMessage(
                  "User environment saved. Open a new shell or sign out/in and fully restart VS Code as needed. Existing processes keep their old environment.",
                );
              } finally {
                environmentEditPending = false;
              }
              return;
            }
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
          if (
            request.type.startsWith("ide.") ||
            request.type === "projects.open"
          ) {
            await vscode.window.showErrorMessage(
              error instanceof Error
                ? error.message
                : "DevDashboardV1 could not open the selected IDE.",
            );
            return;
          }
          if (request.type.startsWith("environment.")) {
            const message =
              error instanceof UserEnvironmentError
                ? error.message
                : "The user environment operation could not finish. Check OS permissions and retry; no administrator elevation or policy bypass was attempted.";
            if (request.type === "environment.search")
              await panel.webview.postMessage({
                type: "environment.results",
                query: request.query,
                names: [],
                message,
              } satisfies ExtensionResponse);
            else await vscode.window.showErrorMessage(message);
            return;
          }
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
      if (dashboardPanel === panel) dashboardPanel = undefined;
      messageSubscription.dispose();
      appChangeSubscription.dispose();
    });
  };

  const openDevDashboardV1 = vscode.commands.registerCommand(OPEN_COMMAND, () =>
    showDevDashboardV1("home"),
  );
  const launchDashboard = () => {
    if (dashboardPanel) dashboardPanel.reveal(vscode.ViewColumn.One);
    else showDevDashboardV1("home");
  };
  const dockedDashboard = vscode.window.createTreeView<vscode.TreeItem>(
    "devdashboardv1.sidebar",
    {
      treeDataProvider: {
        getTreeItem: (item) => item,
        getChildren: () => [],
      },
    },
  );
  const dockVisibility = dockedDashboard.onDidChangeVisibility(
    async ({ visible }) => {
      if (!visible) return;
      await vscode.commands.executeCommand("workbench.action.closeSidebar");
      launchDashboard();
    },
  );
  const dockCommand = vscode.commands.registerCommand(
    "devdashboardv1.dock",
    launchDashboard,
  );
  const openSearch = vscode.commands.registerCommand(SEARCH_COMMAND, () =>
    showDevDashboardV1("search"),
  );
  const openGuide = vscode.commands.registerCommand(GUIDE_COMMAND, () =>
    showDevDashboardV1("home", true),
  );
  const snapshotCommand = vscode.commands.registerCommand(
    SNAPSHOT_COMMAND,
    async () => {
      try {
        await database.createSnapshot();
        await vscode.window.showInformationMessage(
          "Database snapshot saved locally. Snapshots contain private local data but no SecretStorage credentials. The latest 10 are retained.",
        );
      } catch {
        await vscode.window.showErrorMessage(
          "Database snapshot could not be saved. Check disk space and storage permissions. No restore was performed.",
        );
      }
    },
  );
  const restoreCommand = vscode.commands.registerCommand(
    RESTORE_COMMAND,
    async () => {
      try {
        const selected = await selectRestore();
        if (!selected) return;
        await database.restoreSnapshot(selected);
        teamCalendars.clear();
        confluenceService.clearReaderCache();
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      } catch {
        await vscode.window.showErrorMessage(
          "Database restore could not finish. Invalid snapshots are rejected before replacing data. Check permissions/disk space; if replacement succeeded but reload failed, run Developer: Reload Window before editing.",
        );
      }
    },
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
    dockedDashboard,
    dockVisibility,
    dockCommand,
    openSearch,
    openGuide,
    snapshotCommand,
    restoreCommand,
    openLegacyDevWorkspace,
    openLegacySearch,
  );
  // Let an activating command open its own panel before automatic onboarding.
  const onboardingTimer = setTimeout(() => {
    if (
      !panelOpened &&
      walkthroughMode(
        context.globalState.get<string>(walkthroughVersionKey),
        version,
      )
    )
      showDevDashboardV1("home");
  }, 0);
  context.subscriptions.push({ dispose: () => clearTimeout(onboardingTimer) });
}

export function deactivate(): void {
  // No resources survive extension deactivation in the scaffold.
}
