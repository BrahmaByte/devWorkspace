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
}

export interface JiraState {
  readonly connection?: JiraConnection;
  readonly currentUser?: JiraUser;
  readonly issues: readonly JiraIssue[];
  readonly status: "disconnected" | "connected" | "expired" | "error";
  readonly message?: string;
}
