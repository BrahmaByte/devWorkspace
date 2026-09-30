import type { Note, StickyNote } from "../../domain/notes/models";
import type { HomeState } from "../../domain/home/models";
import type { ConfluenceState } from "../../domain/confluence/models";
import type {
  KnowledgeState,
  RelationshipTargetType,
} from "../../domain/knowledge/models";
import type { SearchResultType, SearchState } from "../../domain/search/models";
import type {
  JiraBoardStatus,
  JiraIssue,
  JiraState,
} from "../../domain/jira/models";
import type {
  PreferredIde,
  WorkspaceState,
} from "../../domain/workspace/models";

export const shellPages = [
  "home",
  "jira",
  "workspace",
  "notes",
  "knowledge",
  "settings",
  "search",
] as const;

export type ShellPage = (typeof shellPages)[number];

export type WebviewRequest =
  | { readonly type: "shell.ready" }
  | { readonly type: "home.refresh" }
  | { readonly type: "home.search"; readonly query: string }
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
  | { readonly type: "confluence.open"; readonly id: string }
  | { readonly type: "knowledge.list"; readonly noteId: string }
  | {
      readonly type: "knowledge.attach";
      readonly noteId: string;
      readonly targetType: RelationshipTargetType;
      readonly targetId: string;
    }
  | {
      readonly type: "knowledge.detach";
      readonly noteId: string;
      readonly relationshipId: string;
    }
  | {
      readonly type: "knowledge.open";
      readonly targetType: RelationshipTargetType;
      readonly targetId: string;
    }
  | {
      readonly type: "jira.connect";
      readonly displayName: string;
      readonly baseUrl: string;
    }
  | { readonly type: "jira.refresh" | "jira.disconnect" }
  | { readonly type: "jira.issue"; readonly issueKey: string }
  | { readonly type: "jira.search"; readonly query: string }
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
  | {
      readonly type: "jira.associate";
      readonly issueKey: string;
      readonly projectId: string;
    }
  | {
      readonly type: "jira.startWork";
      readonly issueKey: string;
      readonly branchName?: string;
    }
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
  | {
      readonly type: "notes.pin";
      readonly id: string;
      readonly pinned: boolean;
    }
  | {
      readonly type: "notes.archive";
      readonly id: string;
      readonly archived: boolean;
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
  | { readonly type: "projects.browse" }
  | { readonly type: "commands.browse" }
  | {
      readonly type: "projects.create" | "projects.update";
      readonly id?: string;
      readonly name: string;
      readonly localPath: string;
      readonly preferredIde?: PreferredIde;
    }
  | {
      readonly type: "projects.delete" | "projects.terminal";
      readonly id: string;
    }
  | {
      readonly type: "projects.favourite";
      readonly id: string;
      readonly favourite: boolean;
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
  | {
      readonly type: "home.state";
      readonly state: HomeState;
    }
  | { readonly type: "jira.state"; readonly state: JiraState }
  | { readonly type: "confluence.state"; readonly state: ConfluenceState }
  | { readonly type: "knowledge.state"; readonly state: KnowledgeState }
  | { readonly type: "search.state"; readonly state: SearchState }
  | { readonly type: "search.note"; readonly id: string }
  | {
      readonly type: "integration.error";
      readonly provider: "jira" | "confluence";
      readonly message: string;
    }
  | { readonly type: "jira.issue"; readonly issue: JiraIssue }
  | {
      readonly type: "jira.workStarted";
      readonly projectName: string;
      readonly branchName?: string;
      readonly branchChanged: boolean;
      readonly started: boolean;
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
