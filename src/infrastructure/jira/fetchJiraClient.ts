import type {
  JiraClient,
  JiraClientFactory,
} from "../../application/services/jiraService";
import type { JiraIssue, JiraUser } from "../../domain/jira/models";

type JsonRecord = Record<string, unknown>;

export class FetchJiraClientFactory implements JiraClientFactory {
  public create(baseUrl: string, token: string): JiraClient {
    return new FetchJiraClient(baseUrl, token);
  }
}

export class JiraRequestError extends Error {
  public constructor(public readonly status: number) {
    super(`Jira request failed (${status}).`);
  }
}

export class FetchJiraClient implements JiraClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  public async getCurrentUser(): Promise<JiraUser> {
    const data = await this.request("/rest/api/2/myself");
    return {
      accountId: requiredString(data.accountId ?? data.key ?? data.name),
      displayName: requiredString(data.displayName),
      ...(typeof data.emailAddress === "string"
        ? { emailAddress: data.emailAddress }
        : {}),
    };
  }

  public async getAssignedIssues(): Promise<readonly JiraIssue[]> {
    return this.searchByJql(
      "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
    );
  }

  public async searchIssues(query: string): Promise<readonly JiraIssue[]> {
    return this.searchByJql(query);
  }

  private async searchByJql(jql: string): Promise<readonly JiraIssue[]> {
    const data = await this.request("/rest/api/2/search", {
      method: "POST",
      body: JSON.stringify({
        jql,
        maxResults: 50,
        fields: ["summary", "status", "updated"],
      }),
    });
    if (!Array.isArray(data.issues)) throw new Error("Invalid Jira response.");
    return data.issues.map(toIssue);
  }

  public async getIssue(issueKey: string): Promise<JiraIssue> {
    return toIssue(
      await this.request(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=summary,status,updated,description`,
      ),
    );
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<JsonRecord> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new JiraRequestError(response.status);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > 2_000_000)
      throw new Error("Jira response is too large.");
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error("Jira response is too large.");
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed)) throw new Error("Invalid Jira response.");
    return parsed;
  }
}

function toIssue(value: unknown): JiraIssue {
  if (!isRecord(value) || !isRecord(value.fields))
    throw new Error("Invalid Jira issue.");
  const status = value.fields.status;
  return {
    id: requiredString(value.id),
    key: requiredString(value.key),
    summary: requiredString(value.fields.summary),
    status: isRecord(status) ? requiredString(status.name) : "Unknown",
    updatedAt: requiredString(value.fields.updated),
    ...(typeof value.fields.description === "string"
      ? { description: value.fields.description }
      : {}),
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100_000)
    throw new Error("Invalid Jira response.");
  return value;
}
