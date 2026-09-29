import type { Note, StickyNote } from "../../domain/notes/models";
import type { HomeState } from "../../domain/home/models";
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
] as const;

export type ShellPage = (typeof shellPages)[number];

export type WebviewRequest =
  | { readonly type: "shell.ready" }
  | { readonly type: "home.refresh" }
  | { readonly type: "home.search"; readonly query: string }
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
