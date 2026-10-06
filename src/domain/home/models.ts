import type { StickyNote } from "../notes/models";
import type { UrlGroup } from "./urlGroups";
import type { DeveloperApplicationSummary } from "../apps/models";

export interface HomeState {
  readonly stickyNotes: readonly StickyNote[];
  readonly urlGroups: readonly UrlGroup[];
  readonly developerApplications: readonly DeveloperApplicationSummary[];
}
