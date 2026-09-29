import { randomUUID } from "node:crypto";

import type {
  KnowledgeCandidate,
  KnowledgeState,
  RelationshipTargetType,
} from "../../domain/knowledge/models";
import type { ConfluenceRepository } from "../../infrastructure/database/confluenceRepository";
import type { JiraRepository } from "../../infrastructure/database/jiraRepository";
import type { NoteRepository } from "../../infrastructure/database/noteRepository";
import type { RelationshipRepository } from "../../infrastructure/database/relationshipRepository";
import type { WorkspaceRepository } from "../../infrastructure/database/workspaceRepository";

export class KnowledgeService {
  public constructor(
    private readonly relationships: RelationshipRepository,
    private readonly notes: NoteRepository,
    private readonly jira: JiraRepository,
    private readonly confluence: ConfluenceRepository,
    private readonly workspace: WorkspaceRepository,
  ) {}

  public getState(noteId: string): KnowledgeState {
    this.requireId(noteId);
    if (!this.notes.list().some((note) => note.id === noteId))
      throw new Error("Note not found.");
    const candidates = this.candidates();
    const links = this.relationships.listForNote(noteId).map((relationship) => {
      const candidate = candidates.find(
        (item) =>
          item.type === relationship.targetType &&
          item.id === relationship.targetId,
      );
      return candidate
        ? { ...candidate, relationshipId: relationship.id, stale: false }
        : {
            type: relationship.targetType,
            id: relationship.targetId,
            label: "Unavailable resource",
            detail: "The linked resource is not currently available.",
            relationshipId: relationship.id,
            stale: true,
          };
    });
    return { noteId, links, candidates };
  }

  public async attach(
    noteId: string,
    targetType: RelationshipTargetType,
    targetId: string,
  ): Promise<void> {
    const state = this.getState(noteId);
    if (
      !state.candidates.some(
        (item) => item.type === targetType && item.id === targetId,
      )
    )
      throw new Error("Linked resource is not available.");
    await this.relationships.create({
      id: randomUUID(),
      noteId,
      targetType,
      targetId,
      createdAt: new Date().toISOString(),
    });
  }
  public async detach(noteId: string, relationshipId: string): Promise<void> {
    this.requireId(noteId);
    this.requireId(relationshipId);
    if (
      !this.relationships
        .listForNote(noteId)
        .some((item) => item.id === relationshipId)
    )
      throw new Error("Relationship not found.");
    await this.relationships.delete(relationshipId);
  }
  public deleteForResource(
    type: "note" | "project",
    id: string,
  ): Promise<void> {
    this.requireId(id);
    return this.relationships.deleteForResource(type, id);
  }

  private candidates(): readonly KnowledgeCandidate[] {
    const jiraConnection = this.jira.getConnection();
    const confluenceConnection = this.confluence.getConnection();
    return [
      ...(jiraConnection
        ? this.jira.listIssues(jiraConnection.id).map((item) => ({
            type: "jira_issue" as const,
            id: item.key,
            label: item.key,
            detail: item.summary,
          }))
        : []),
      ...(confluenceConnection
        ? this.confluence.listPages(confluenceConnection.id).map((item) => ({
            type: "confluence_page" as const,
            id: item.id,
            label: item.title,
            detail: "Confluence page",
          }))
        : []),
      ...this.workspace.getState().projects.map((item) => ({
        type: "project" as const,
        id: item.id,
        label: item.name,
        detail: item.localPath,
      })),
    ];
  }
  private requireId(id: string): void {
    if (!/^[0-9a-f-]{36}$/iu.test(id)) throw new Error("Invalid identifier.");
  }
}
