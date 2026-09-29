import type { HomeState, RecentResource } from "../../domain/home/models";
import type { NoteRepository } from "../../infrastructure/database/noteRepository";
import type { WorkspaceRepository } from "../../infrastructure/database/workspaceRepository";

export class HomeService {
  public constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly noteRepository: NoteRepository,
  ) {}

  public getState(): HomeState {
    const workspace = this.workspaceRepository.getState();
    const notes = this.noteRepository.list().filter((note) => !note.isArchived);
    const projectsByRecency = [...workspace.projects].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
    const recentResources: RecentResource[] = [
      ...projectsByRecency.map((project) => ({
        id: project.id,
        type: "project" as const,
        title: project.name,
        detail: project.localPath,
        updatedAt: project.updatedAt,
      })),
      ...notes.map((note) => ({
        id: note.id,
        type: "note" as const,
        title: note.title,
        detail: note.content.slice(0, 140),
        updatedAt: note.updatedAt,
      })),
    ]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 6);

    return {
      currentProject: projectsByRecency[0],
      favouriteProjects: workspace.projects
        .filter((project) => project.isFavourite)
        .slice(0, 6),
      quickCommands: workspace.commands.slice(0, 6),
      recentResources,
      stickyNotes: this.noteRepository.listStickyNotes(),
      jira: { connected: false },
    };
  }
}
