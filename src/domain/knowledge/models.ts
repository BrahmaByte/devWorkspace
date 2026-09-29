export const relationshipTargetTypes = [
  "jira_issue",
  "confluence_page",
  "project",
] as const;
export type RelationshipTargetType = (typeof relationshipTargetTypes)[number];

export interface KnowledgeCandidate {
  readonly type: RelationshipTargetType;
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export interface LinkedContext extends KnowledgeCandidate {
  readonly relationshipId: string;
  readonly stale: boolean;
}

export interface KnowledgeState {
  readonly noteId: string;
  readonly links: readonly LinkedContext[];
  readonly candidates: readonly KnowledgeCandidate[];
}
