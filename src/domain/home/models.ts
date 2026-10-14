import type { StickyNote } from "../notes/models";
import type { UrlGroup } from "./urlGroups";
import type { DeveloperApplicationSummary } from "../apps/models";
import type { JiraIssue } from "../jira/models";
import type { CalendarEntry } from "../calendar";
import type { Reminder } from "./reminders";

export interface HomeState {
  readonly stickyNotes: readonly StickyNote[];
  readonly urlGroups: readonly UrlGroup[];
  readonly developerApplications: readonly DeveloperApplicationSummary[];
  readonly recentJiraIssues?: readonly JiraIssue[];
  readonly recentJiraMessage?: string;
  readonly nextMeeting?: CalendarEntry;
  readonly nextMeetingLink?: boolean;
  readonly todaySchedule?: readonly CalendarEntry[];
  readonly reminders: readonly Reminder[];
}
