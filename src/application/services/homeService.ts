import type { HomeState } from "../../domain/home/models";
import type { NoteRepository } from "../../infrastructure/database/noteRepository";
import type { UrlGroupRepository } from "../../infrastructure/database/urlGroupRepository";
import type { DeveloperApplicationService } from "./developerApplicationService";

export class HomeService {
  public constructor(
    private readonly noteRepository: NoteRepository,
    private readonly urlGroupRepository: UrlGroupRepository,
    private readonly developerApplicationService: DeveloperApplicationService,
  ) {}

  public getState(): HomeState {
    return {
      stickyNotes: this.noteRepository.listStickyNotes(),
      urlGroups: this.urlGroupRepository.list(),
      developerApplications: this.developerApplicationService.list(),
    };
  }
}
