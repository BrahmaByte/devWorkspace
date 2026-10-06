export interface JiraConnection {
  readonly id: string;
  readonly baseUrl: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface JiraUser {
  readonly accountId: string;
  readonly displayName: string;
  readonly emailAddress?: string;
}

export interface JiraIssue {
  readonly id: string;
  readonly key: string;
  readonly summary: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly description?: string;
  readonly descriptionHtml?: string;
  readonly issueType?: string;
  readonly priority?: string;
  readonly assignee?: string;
  readonly reporter?: string;
  readonly parentKey?: string;
  readonly labels?: readonly string[];
  readonly createdAt?: string;
}

export interface JiraComment {
  readonly id: string;
  readonly author: string;
  readonly createdAt: string;
  readonly html: string;
}
export interface JiraCommentPage {
  readonly comments: readonly JiraComment[];
  readonly nextStartAt?: number;
}

export const jiraBoardStatuses = ["todo", "in_progress", "done"] as const;
export type JiraBoardStatus = (typeof jiraBoardStatuses)[number];

export interface JiraLocalCard {
  readonly id: string;
  readonly summary: string;
  readonly status: JiraBoardStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface JiraState {
  readonly connection?: JiraConnection;
  readonly currentUser?: JiraUser;
  readonly issues: readonly JiraIssue[];
  readonly localCards: readonly JiraLocalCard[];
  readonly status: "disconnected" | "connected" | "expired" | "error";
  readonly message?: string;
  readonly filter: string;
}
