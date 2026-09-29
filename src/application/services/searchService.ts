import type { SearchResult, SearchState } from "../../domain/search/models";
import type { ConfluenceRepository } from "../../infrastructure/database/confluenceRepository";
import type { JiraRepository } from "../../infrastructure/database/jiraRepository";
import type { NoteRepository } from "../../infrastructure/database/noteRepository";
import type { WorkspaceRepository } from "../../infrastructure/database/workspaceRepository";

export interface SearchProvider {
  readonly name: string;
  search(query: string): readonly SearchResult[];
}
export const searchLimit = 200;

export class SearchService {
  public constructor(private readonly providers: readonly SearchProvider[]) {}
  public search(query: string): SearchState {
    const normalized = query.trim();
    if (query.length > searchLimit || /[\r\n\0]/u.test(query))
      throw new Error("Search query is invalid.");
    const results: SearchResult[] = [];
    const unavailableProviders: string[] = [];
    for (const provider of this.providers) {
      try {
        results.push(...provider.search(normalized));
      } catch {
        unavailableProviders.push(provider.name);
      }
    }
    return {
      query,
      results: results
        .sort((left, right) =>
          (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
        )
        .slice(0, 50),
      unavailableProviders,
    };
  }
}

export class LocalSearchProvider implements SearchProvider {
  public readonly name = "Local workspace";
  public constructor(
    private readonly notes: NoteRepository,
    private readonly workspace: WorkspaceRepository,
  ) {}
  public search(query: string): readonly SearchResult[] {
    const state = this.workspace.getState();
    const includes = (value: string) =>
      !query || value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    return [
      ...this.notes
        .list(query)
        .filter((note) => !note.isArchived)
        .map((note) => ({
          id: note.id,
          type: "note" as const,
          title: note.title,
          detail: note.content.slice(0, 140),
          updatedAt: note.updatedAt,
        })),
      ...state.projects
        .filter((item) => includes(item.name) || includes(item.localPath))
        .map((item) => ({
          id: item.id,
          type: "project" as const,
          title: item.name,
          detail: item.localPath,
          updatedAt: item.updatedAt,
        })),
      ...state.commands
        .filter((item) => includes(item.name) || includes(item.command))
        .map((item) => ({
          id: item.id,
          type: "command" as const,
          title: item.name,
          detail: item.command,
        })),
    ];
  }
}
export class JiraCacheSearchProvider implements SearchProvider {
  public readonly name = "Jira";
  public constructor(private readonly repository: JiraRepository) {}
  public search(query: string): readonly SearchResult[] {
    const connection = this.repository.getConnection();
    if (!connection) throw new Error("Jira unavailable.");
    const includes = (value: string) =>
      !query || value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    return this.repository
      .listIssues(connection.id)
      .filter((item) => includes(item.key) || includes(item.summary))
      .map((item) => ({
        id: item.key,
        type: "jira_issue" as const,
        title: item.key,
        detail: item.summary,
        updatedAt: item.updatedAt,
      }));
  }
}
export class ConfluenceCacheSearchProvider implements SearchProvider {
  public readonly name = "Confluence";
  public constructor(private readonly repository: ConfluenceRepository) {}
  public search(query: string): readonly SearchResult[] {
    const connection = this.repository.getConnection();
    if (!connection) throw new Error("Confluence unavailable.");
    const includes = (value: string) =>
      !query || value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    return this.repository
      .listPages(connection.id)
      .filter((item) => includes(item.title))
      .map((item) => ({
        id: item.id,
        type: "confluence_page" as const,
        title: item.title,
        detail: "Confluence page",
        updatedAt: item.updatedAt,
      }));
  }
}
