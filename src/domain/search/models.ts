export const searchResultTypes = [
  "note",
  "project",
  "command",
  "jira_issue",
  "confluence_page",
] as const;
export type SearchResultType = (typeof searchResultTypes)[number];
export interface SearchResult {
  readonly id: string;
  readonly type: SearchResultType;
  readonly title: string;
  readonly detail: string;
  readonly updatedAt?: string;
}
export interface SearchState {
  readonly query: string;
  readonly results: readonly SearchResult[];
  readonly unavailableProviders: readonly string[];
}
