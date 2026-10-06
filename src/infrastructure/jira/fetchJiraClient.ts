import type {
  JiraClient,
  JiraClientFactory,
} from "../../application/services/jiraService";
import type {
  JiraIssue,
  JiraUser,
  JiraComment,
  JiraCommentPage,
} from "../../domain/jira/models";
import {
  authorizationHeader,
  type AtlassianCredential,
} from "../../application/services/atlassianAuth";
import { VscodeHttpTransport } from "../http/vscodeHttpTransport";
import { formatJiraDescription } from "../http/richText";
import { sanitizeConfluenceHtml } from "../confluence/fetchConfluenceClient";

type JsonRecord = Record<string, unknown>;

export class FetchJiraClientFactory implements JiraClientFactory {
  public constructor(
    private readonly transport: VscodeHttpTransport = new VscodeHttpTransport(),
  ) {}

  public create(baseUrl: string, credential: AtlassianCredential): JiraClient {
    return new FetchJiraClient(baseUrl, credential, this.transport);
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
    private readonly credential: AtlassianCredential,
    private readonly transport: VscodeHttpTransport = new VscodeHttpTransport(),
  ) {}

  public async getCurrentUser(): Promise<JiraUser> {
    const data = await this.request(`/rest/api/${this.apiVersion}/myself`);
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
    const searchPath =
      this.credential.type === "basic"
        ? "/rest/api/3/search/jql"
        : "/rest/api/2/search";
    const data = await this.request(searchPath, {
      method: "POST",
      body: JSON.stringify({
        jql,
        maxResults: 50,
        fields: [
          "summary",
          "status",
          "updated",
          "description",
          "issuetype",
          "priority",
          "assignee",
          "reporter",
          "parent",
          "labels",
          "created",
        ],
      }),
    });
    if (!Array.isArray(data.issues)) throw new Error("Invalid Jira response.");
    return data.issues.map(toIssue);
  }

  public async getIssue(issueKey: string): Promise<JiraIssue> {
    return toIssue(
      await this.request(
        `/rest/api/${this.apiVersion}/issue/${encodeURIComponent(issueKey)}?fields=summary,status,updated,description,issuetype,priority,assignee,reporter,parent,labels,created&expand=renderedFields`,
      ),
    );
  }

  private get apiVersion(): 2 | 3 {
    return this.credential.type === "basic" ? 3 : 2;
  }

  public async getComments(
    issueKey: string,
    startAt: number,
  ): Promise<JiraCommentPage> {
    const data = await this.request(
      `/rest/api/${this.apiVersion}/issue/${encodeURIComponent(issueKey)}/comment?startAt=${startAt}&maxResults=50&orderBy=created&expand=renderedBody`,
    );
    if (!Array.isArray(data.comments) || data.comments.length > 50)
      throw new Error("Invalid Jira comments.");
    const next = startAt + data.comments.length;
    return {
      comments: data.comments.map(toComment),
      ...(typeof data.total === "number" && next < data.total && next > startAt
        ? { nextStartAt: next }
        : {}),
    };
  }
  public async addComment(
    issueKey: string,
    text: string,
  ): Promise<JiraComment> {
    const body =
      this.apiVersion === 3
        ? {
            type: "doc",
            version: 1,
            content: text.split(/\r\n|\n|\r/u).map((line) => ({
              type: "paragraph",
              content: line ? [{ type: "text", text: line }] : [],
            })),
          }
        : text;
    return toComment(
      await this.request(
        `/rest/api/${this.apiVersion}/issue/${encodeURIComponent(issueKey)}/comment?expand=renderedBody`,
        { method: "POST", body: JSON.stringify({ body }) },
      ),
    );
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<JsonRecord> {
    const response = await this.transport.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: authorizationHeader(this.credential),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
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

function toComment(value: unknown): JiraComment {
  if (!isRecord(value)) throw new Error("Invalid Jira comment.");
  return {
    id: requiredString(value.id),
    author:
      isRecord(value.author) && typeof value.author.displayName === "string"
        ? value.author.displayName
        : "Unknown",
    createdAt: requiredString(value.created),
    html: sanitizeConfluenceHtml(
      typeof value.renderedBody === "string"
        ? value.renderedBody
        : formatJiraDescription(value.body),
    ).html,
  };
}

function toIssue(value: unknown): JiraIssue {
  if (!isRecord(value) || !isRecord(value.fields))
    throw new Error("Invalid Jira issue.");
  const status = value.fields.status;
  const issueType = value.fields.issuetype;
  const priority = value.fields.priority;
  const assignee = value.fields.assignee;
  const reporter = value.fields.reporter;
  const parent = value.fields.parent;
  const labels = value.fields.labels;
  const rendered = isRecord(value.renderedFields)
    ? value.renderedFields.description
    : undefined;
  const descriptionHtml = sanitizeConfluenceHtml(
    typeof rendered === "string" && rendered.trim()
      ? rendered
      : formatJiraDescription(value.fields.description),
  ).html;
  return {
    id: requiredString(value.id),
    key: requiredString(value.key),
    summary: requiredString(value.fields.summary),
    status: isRecord(status) ? requiredString(status.name) : "Unknown",
    updatedAt: requiredString(value.fields.updated),
    ...(descriptionHtml ? { descriptionHtml } : {}),
    ...(descriptionText(value.fields.description)
      ? { description: descriptionText(value.fields.description) }
      : {}),
    ...(isRecord(issueType) && typeof issueType.name === "string"
      ? { issueType: issueType.name }
      : {}),
    ...(isRecord(priority) && typeof priority.name === "string"
      ? { priority: priority.name }
      : {}),
    ...(isRecord(assignee) && typeof assignee.displayName === "string"
      ? { assignee: assignee.displayName }
      : {}),
    ...(isRecord(reporter) && typeof reporter.displayName === "string"
      ? { reporter: reporter.displayName }
      : {}),
    ...(isRecord(parent) && typeof parent.key === "string"
      ? { parentKey: parent.key }
      : {}),
    ...(Array.isArray(labels) &&
    labels.every((label) => typeof label === "string")
      ? { labels }
      : {}),
    ...(typeof value.fields.created === "string"
      ? { createdAt: value.fields.created }
      : {}),
  };
}

function descriptionText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value) && !Array.isArray(value)) return undefined;
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (isRecord(node)) {
      if (typeof node.text === "string") parts.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(visit);
      if (node.type === "paragraph" || node.type === "heading")
        parts.push("\n");
    } else if (Array.isArray(node)) node.forEach(visit);
  };
  visit(value);
  const result = parts.join("").trim();
  return result || undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100_000)
    throw new Error("Invalid Jira response.");
  return value;
}
