import { randomUUID } from "node:crypto";

import type {
  JiraConnection,
  JiraIssue,
  JiraState,
  JiraUser,
} from "../../domain/jira/models";
import type { JiraRepository } from "../../infrastructure/database/jiraRepository";

export interface JiraClient {
  getCurrentUser(): Promise<JiraUser>;
  getAssignedIssues(): Promise<readonly JiraIssue[]>;
  getIssue(issueKey: string): Promise<JiraIssue>;
}

export interface JiraClientFactory {
  create(baseUrl: string, token: string): JiraClient;
}

export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export const jiraLimits = { name: 100, url: 2_000 } as const;
const secretKey = (connectionId: string) =>
  `devworkspace.jira.${connectionId}.pat`;

export class JiraService {
  public constructor(
    private readonly repository: JiraRepository,
    private readonly secrets: SecretStore,
    private readonly clients: JiraClientFactory,
  ) {}

  public async connect(
    displayName: string,
    baseUrl: string,
    token: string,
  ): Promise<JiraState> {
    const normalizedUrl = this.validateUrl(baseUrl);
    if (!displayName.trim() || displayName.length > jiraLimits.name)
      throw new Error("Connection name is invalid.");
    if (!token.trim()) throw new Error("A personal access token is required.");
    const client = this.clients.create(normalizedUrl, token);
    const [currentUser, issues] = await Promise.all([
      client.getCurrentUser(),
      client.getAssignedIssues(),
    ]);
    const existing = this.repository.getConnection();
    const now = new Date().toISOString();
    const connection: JiraConnection = {
      id: existing?.id ?? randomUUID(),
      displayName: displayName.trim(),
      baseUrl: normalizedUrl,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.secrets.store(secretKey(connection.id), token);
    try {
      await this.repository.saveConnection(connection);
      await this.repository.replaceIssues(connection.id, issues);
    } catch (error) {
      await this.secrets.delete(secretKey(connection.id));
      throw error;
    }
    return { connection, currentUser, issues, status: "connected" };
  }

  public async refresh(): Promise<JiraState> {
    const connection = this.repository.getConnection();
    if (!connection) return { issues: [], status: "disconnected" };
    const token = await this.secrets.get(secretKey(connection.id));
    if (!token)
      return {
        connection,
        issues: this.repository.listIssues(connection.id),
        status: "expired",
        message: "The Jira personal access token is unavailable.",
      };
    try {
      const client = this.clients.create(connection.baseUrl, token);
      const [currentUser, issues] = await Promise.all([
        client.getCurrentUser(),
        client.getAssignedIssues(),
      ]);
      await this.repository.replaceIssues(connection.id, issues);
      return { connection, currentUser, issues, status: "connected" };
    } catch (error) {
      const authenticationFailed =
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        (error.status === 401 || error.status === 403);
      return {
        connection,
        issues: this.repository.listIssues(connection.id),
        status: authenticationFailed ? "expired" : "error",
        message: authenticationFailed
          ? "The Jira personal access token was rejected or has expired."
          : "Jira could not be reached. Showing locally cached issues.",
      };
    }
  }

  public async getIssue(issueKey: string): Promise<JiraIssue> {
    if (!/^[A-Z][A-Z0-9_]{0,19}-[1-9][0-9]{0,9}$/u.test(issueKey))
      throw new Error("Issue key is invalid.");
    const connection = this.repository.getConnection();
    if (!connection) throw new Error("Jira is not connected.");
    const token = await this.secrets.get(secretKey(connection.id));
    if (!token) throw new Error("Jira credentials are unavailable.");
    return this.clients.create(connection.baseUrl, token).getIssue(issueKey);
  }

  public async disconnect(): Promise<void> {
    const connection = this.repository.getConnection();
    if (!connection) return;
    await this.secrets.delete(secretKey(connection.id));
    await this.repository.deleteConnection(connection.id);
  }

  private validateUrl(value: string): string {
    if (!value || value.length > jiraLimits.url)
      throw new Error("Jira URL is invalid.");
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    )
      throw new Error("Jira URL must use HTTPS.");
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/u, "");
  }
}
