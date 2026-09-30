import type { StickyNote } from "../notes/models";
import type { Project, ProjectCommand } from "../workspace/models";
import type { UrlGroup } from "./urlGroups";

export interface RecentResource {
  readonly id: string;
  readonly type: "note" | "project";
  readonly title: string;
  readonly detail: string;
  readonly updatedAt: string;
}

export interface HomeState {
  readonly currentProject?: Project;
  readonly favouriteProjects: readonly Project[];
  readonly quickCommands: readonly ProjectCommand[];
  readonly recentResources: readonly RecentResource[];
  readonly stickyNotes: readonly StickyNote[];
  readonly urlGroups: readonly UrlGroup[];
  readonly jira: { readonly connected: false };
}
