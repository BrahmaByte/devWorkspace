import type { Note, StickyNote } from "../../domain/notes/models";
import type {
  CalendarInput,
  CalendarState,
  LeaveType,
  TeamCalendarSource,
} from "../../domain/calendar";
import type { HomeState } from "../../domain/home/models";
import type {
  ConfluenceReaderDocument,
  ConfluenceState,
} from "../../domain/confluence/models";
import type { SearchResultType, SearchState } from "../../domain/search/models";
import type {
  JiraBoardStatus,
  JiraComment,
  JiraCommentPage,
  JiraIssue,
  JiraSavedFilter,
  JiraState,
  JiraQuickFilter,
} from "../../domain/jira/models";
import type { WorkspaceState } from "../../domain/workspace/models";
import type { GitHubState } from "../../domain/github";

export const shellPages = [
  "home",
  "jira",
  "calendar",
  "workspace",
  "notes",
  "knowledge",
  "settings",
  "search",
] as const;

export type ShellPage = (typeof shellPages)[number];

export type WebviewRequest =
  | {
      readonly type:
        | "github.configure"
        | "github.disconnect"
        | "github.refresh"
        | "github.status";
    }
  | {
      readonly type: "github.repositories";
      readonly owner: string;
      readonly more: boolean;
    }
  | { readonly type: "github.clone"; readonly id: string }
  | { readonly type: "calendar.refresh"; readonly year: number }
  | {
      readonly type: "calendar.source.connect";
      readonly year: number;
      readonly name: string;
      readonly color: `#${string}`;
      readonly holidays: boolean;
    }
  | {
      readonly type:
        | "calendar.source.refresh"
        | "calendar.source.remove"
        | "calendar.source.event";
      readonly year: number;
      readonly id: string;
    }
  | {
      readonly type: "calendar.save";
      readonly year: number;
      readonly entry: CalendarInput;
    }
  | {
      readonly type: "calendar.delete" | "calendar.type.delete";
      readonly year: number;
      readonly id: string;
    }
  | {
      readonly type: "calendar.type.save";
      readonly year: number;
      readonly leaveType: Omit<LeaveType, "id"> & { readonly id?: string };
    }
  | { readonly type: "walkthrough.open" }
  | { readonly type: "network.configure" }
  | { readonly type: "shell.ready" }
  | { readonly type: "home.refresh" }
  | { readonly type: "home.search"; readonly query: string }
  | {
      readonly type: "urls.create";
      readonly name: string;
      readonly urls: readonly string[];
    }
  | {
      readonly type: "urls.update";
      readonly id: string;
      readonly name: string;
      readonly urls: readonly string[];
    }
  | { readonly type: "urls.delete" | "urls.openAll"; readonly id: string }
  | { readonly type: "urls.open"; readonly id: string; readonly index: number }
  | { readonly type: "apps.browse" }
  | {
      readonly type: "apps.launch" | "apps.close" | "apps.delete";
      readonly id: string;
    }
  | { readonly type: "search.query"; readonly query: string }
  | {
      readonly type: "search.open";
      readonly resultType: SearchResultType;
      readonly id: string;
    }
  | {
      readonly type: "confluence.connect";
      readonly displayName: string;
      readonly baseUrl: string;
    }
  | { readonly type: "confluence.refresh" | "confluence.disconnect" }
  | { readonly type: "confluence.search"; readonly query: string }
  | {
      readonly type:
        | "confluence.open"
        | "confluence.reader"
        | "confluence.preview"
        | "confluence.bookmark";
      readonly id: string;
      readonly noteId?: string;
    }
  | {
      readonly type: "jira.connect";
      readonly displayName: string;
      readonly baseUrl: string;
    }
  | { readonly type: "jira.refresh" | "jira.disconnect" }
  | { readonly type: "jira.issue"; readonly issueKey: string }
  | {
      readonly type: "jira.comments";
      readonly issueKey: string;
      readonly startAt: number;
    }
  | {
      readonly type: "jira.comment.add";
      readonly issueKey: string;
      readonly body: string;
    }
  | { readonly type: "jira.open"; readonly issueKey: string }
  | { readonly type: "jira.search"; readonly query: string }
  | { readonly type: "jira.filters" }
  | { readonly type: "jira.preset"; readonly preset: JiraQuickFilter }
  | {
      readonly type: "jira.local.create";
      readonly summary: string;
      readonly status: JiraBoardStatus;
    }
  | {
      readonly type: "jira.local.move";
      readonly id: string;
      readonly status: JiraBoardStatus;
    }
  | { readonly type: "jira.local.delete"; readonly id: string }
  | { readonly type: "navigation.select"; readonly page: ShellPage }
  | { readonly type: "notes.refresh"; readonly query: string }
  | {
      readonly type: "notes.create";
      readonly title: string;
      readonly content: string;
    }
  | {
      readonly type: "notes.update";
      readonly id: string;
      readonly title: string;
      readonly content: string;
    }
  | { readonly type: "notes.delete"; readonly id: string }
  | {
      readonly type: "sticky.create";
      readonly content: string;
      readonly color: "yellow" | "blue" | "green" | "pink";
      readonly sortOrder: number;
    }
  | {
      readonly type: "sticky.update";
      readonly id: string;
      readonly content: string;
      readonly color: "yellow" | "blue" | "green" | "pink";
      readonly sortOrder: number;
    }
  | { readonly type: "sticky.delete"; readonly id: string }
  | { readonly type: "workspace.refresh" }
  | { readonly type: "environment.search"; readonly query: string }
  | { readonly type: "environment.configure"; readonly name?: string }
  | { readonly type: "projects.browse" }
  | { readonly type: "commands.browse" }
  | {
      readonly type: "projects.create" | "projects.update";
      readonly id?: string;
      readonly name: string;
      readonly localPath: string;
    }
  | {
      readonly type: "projects.delete" | "projects.terminal";
      readonly id: string;
    }
  | {
      readonly type: "commands.create";
      readonly name: string;
      readonly command: string;
      readonly workingDirectory?: string;
    }
  | {
      readonly type: "commands.delete" | "commands.execute";
      readonly id: string;
    }
  | {
      readonly type: "environments.create";
      readonly projectId?: string;
      readonly name: string;
      readonly description: string;
      readonly variableNames: readonly string[];
    }
  | { readonly type: "environments.delete"; readonly id: string };

export type ExtensionResponse =
  | { readonly type: "github.state"; readonly state: GitHubState }
  | {
      readonly type: "calendar.state" | "calendar.saved";
      readonly state: CalendarState;
    }
  | { readonly type: "calendar.error"; readonly message: string }
  | { readonly type: "calendar.invalidated" }
  | {
      readonly type: "calendar.sources";
      readonly sources: readonly TeamCalendarSource[];
      readonly message?: string;
      readonly error?: boolean;
    }
  | { readonly type: "urls.saved" }
  | {
      readonly type: "environment.results";
      readonly query: string;
      readonly names: readonly string[];
      readonly message?: string;
    }
  | {
      readonly type: "walkthrough.state";
      readonly mode: "tour" | "update";
      readonly version: string;
    }
  | {
      readonly type: "home.state";
      readonly state: HomeState;
    }
  | { readonly type: "jira.state"; readonly state: JiraState }
  | {
      readonly type: "jira.filters";
      readonly filters: readonly JiraSavedFilter[];
      readonly message?: string;
    }
  | { readonly type: "confluence.state"; readonly state: ConfluenceState }
  | {
      readonly type: "confluence.reader" | "confluence.preview";
      readonly document: ConfluenceReaderDocument;
    }
  | {
      readonly type: "confluence.readError";
      readonly id: string;
      readonly target: "preview" | "reader";
      readonly message: string;
    }
  | { readonly type: "confluence.bookmarked"; readonly noteId: string }
  | { readonly type: "search.state"; readonly state: SearchState }
  | { readonly type: "search.note"; readonly id: string }
  | {
      readonly type: "integration.error";
      readonly provider: "jira" | "confluence";
      readonly message: string;
    }
  | { readonly type: "jira.issue"; readonly issue: JiraIssue }
  | {
      readonly type: "jira.comments";
      readonly issueKey: string;
      readonly startAt: number;
      readonly page: JiraCommentPage;
    }
  | {
      readonly type: "jira.comment.result";
      readonly issueKey: string;
      readonly comment?: JiraComment;
      readonly message?: string;
    }
  | {
      readonly type: "jira.viewer.error";
      readonly issueKey: string;
      readonly target: "issue" | "comments";
      readonly message: string;
    }
  | {
      readonly type: "shell.state";
      readonly page: ShellPage;
      readonly platform: "windows" | "macos" | "linux";
    }
  | {
      readonly type: "protocol.error";
      readonly code: "invalid_message" | "operation_failed";
      readonly message: string;
    }
  | {
      readonly type: "notes.state";
      readonly query: string;
      readonly notes: readonly Note[];
      readonly stickyNotes: readonly StickyNote[];
    }
  | {
      readonly type: "notes.created";
      readonly id: string;
    }
  | {
      readonly type: "projects.pathSelected";
      readonly localPath: string;
      readonly name: string;
    }
  | {
      readonly type: "commands.pathSelected";
      readonly localPath: string;
    }
  | ({
      readonly type: "workspace.state";
    } & WorkspaceState);
