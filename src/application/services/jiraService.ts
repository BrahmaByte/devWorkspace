import { randomUUID } from "node:crypto";

import type {
  JiraConnection,
  JiraComment,
  JiraCommentPage,
  JiraBoardStatus,
  JiraIssue,
  JiraState,
  JiraUser,
} from "../../domain/jira/models";
import type { JiraRepository } from "../../infrastructure/database/jiraRepository";
import {
  createAtlassianCredential,
  deserializeCredential,
  serializeCredential,
  type AtlassianCredential,
} from "./atlassianAuth";

export interface JiraClient {
  getCurrentUser(): Promise<JiraUser>;
  getAssignedIssues(): Promise<readonly JiraIssue[]>;
  searchIssues(query: string): Promise<readonly JiraIssue[]>;
  getIssue(issueKey: string): Promise<JiraIssue>;
  getComments(issueKey: string, startAt: number): Promise<JiraCommentPage>;
  addComment(issueKey: string, body: string): Promise<JiraComment>;
}

export interface JiraClientFactory {
  create(baseUrl: string, credential: AtlassianCredential): JiraClient;
}

export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export const jiraLimits = { name: 100, url: 2_000 } as const;
export const jiraBoardLimits = { filter: 500, localSummary: 200 } as const;
const secretKey = (connectionId: string) =>
  `devworkspace.jira.${connectionId}.pat`;

export class JiraService {
  private recentConnectionId: string | undefined;
  private recentIssues: readonly JiraIssue[] = [];
  private recentGeneration = 0;
  private recentMessage: string | undefined;

  public async getRecentIssues(refresh = true): Promise<{
    issues: readonly JiraIssue[];
    message?: string;
  }> {
    const generation = this.recentGeneration;
    const connection = this.repository.getConnection();
    if (connection?.id !== this.recentConnectionId) {
      this.recentConnectionId = connection?.id;
      this.recentIssues = [];
      this.recentMessage = undefined;
    }
    if (!connection) return { issues: [] };
    const stored = await this.secrets.get(secretKey(connection.id));
    if (!stored)
      return { issues: [], message: "Reconnect Jira to load recent work." };
    if (!refresh)
      return { issues: this.recentIssues, message: this.recentMessage };
    try {
      const issues = await this.clients
        .create(connection.baseUrl, deserializeCredential(stored))
        .searchIssues("assignee = currentUser() ORDER BY updated DESC");
      if (
        generation !== this.recentGeneration ||
        this.repository.getConnection()?.id !== connection.id ||
        (await this.secrets.get(secretKey(connection.id))) !== stored
      )
        return { issues: [] };
      this.recentIssues = [...issues]
        .sort(
          (a, b) =>
            (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) ||
            a.key.localeCompare(b.key),
        )
        .slice(0, 5);
      this.recentMessage = undefined;
      return { issues: this.recentIssues };
    } catch {
      if (generation !== this.recentGeneration) return { issues: [] };
      this.recentMessage =
        "Recent Jira work could not refresh. Showing last loaded issues.";
      return { issues: this.recentIssues, message: this.recentMessage };
    }
  }
  private readonly posting = new Set<string>();
  private async commentClient(issueKey: string): Promise<JiraClient> {
    this.getIssueUrl(issueKey);
    const connection = this.repository.getConnection();
    if (!connection) throw new Error("Jira is not connected.");
    const stored = await this.secrets.get(secretKey(connection.id));
    if (!stored) throw new Error("Jira credentials are unavailable.");
    return this.clients.create(
      connection.baseUrl,
      deserializeCredential(stored),
    );
  }
  public async getComments(
    issueKey: string,
    startAt = 0,
  ): Promise<JiraCommentPage> {
    if (!Number.isInteger(startAt) || startAt < 0 || startAt > 1_000_000)
      throw new Error("Comment offset is invalid.");
    return (await this.commentClient(issueKey)).getComments(issueKey, startAt);
  }
  public async addComment(
    issueKey: string,
    body: string,
  ): Promise<JiraComment> {
    if (!body.trim() || body.length > 10_000 || body.includes("\0"))
      throw new Error("Comment is invalid.");
    if (this.posting.has(issueKey))
      throw new Error("A comment is already being posted.");
    this.posting.add(issueKey);
    try {
      return await (
        await this.commentClient(issueKey)
      ).addComment(issueKey, body);
    } finally {
      this.posting.delete(issueKey);
    }
  }
  public constructor(
    private readonly repository: JiraRepository,
    private readonly secrets: SecretStore,
    private readonly clients: JiraClientFactory,
  ) {}

  public async connect(
    displayName: string,
    baseUrl: string,
    token: string,
    email?: string,
  ): Promise<JiraState> {
    this.recentGeneration++;
    this.recentIssues = [];
    this.recentMessage = undefined;
    const normalizedUrl = this.validateUrl(baseUrl);
    if (!displayName.trim() || displayName.length > jiraLimits.name)
      throw new Error("Connection name is invalid.");
    const credential = createAtlassianCredential(normalizedUrl, token, email);
    const client = this.clients.create(normalizedUrl, credential);
    const currentUser = await client.getCurrentUser();
    const existing = this.repository.getConnection();
    const filter = this.repository.getFilter();
    let issues = existing
      ? this.repository.listIssues(existing.id)
      : ([] as readonly JiraIssue[]);
    let issueWarning: string | undefined;
    try {
      issues = filter
        ? await client.searchIssues(filter)
        : await client.getAssignedIssues();
    } catch (error) {
      const denied = hasStatus(error, 401, 403);
      issueWarning = denied
        ? "Connected to Jira, but this account cannot load assigned issues. Check Browse Projects and issue permissions."
        : "Connected to Jira, but assigned issues could not be loaded. Check the network and Jira availability.";
    }
    const now = new Date().toISOString();
    const connection: JiraConnection = {
      id: existing?.id ?? randomUUID(),
      displayName: displayName.trim(),
      baseUrl: normalizedUrl,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.secrets.store(
      secretKey(connection.id),
      serializeCredential(credential),
    );
    try {
      await this.repository.saveConnection(connection);
      if (!issueWarning)
        await this.repository.replaceIssues(connection.id, issues);
    } catch (error) {
      await this.secrets.delete(secretKey(connection.id));
      throw error;
    }
    return {
      connection,
      currentUser,
      issues,
      localCards: this.repository.listLocalCards(),
      status: "connected",
      ...(issueWarning ? { message: issueWarning } : {}),
      filter,
    };
  }

  public async refresh(): Promise<JiraState> {
    const connection = this.repository.getConnection();
    const localCards = this.repository.listLocalCards();
    const filter = this.repository.getFilter();
    if (!connection)
      return { issues: [], localCards, status: "disconnected", filter };
    const storedCredential = await this.secrets.get(secretKey(connection.id));
    if (!storedCredential)
      return {
        connection,
        issues: this.repository.listIssues(connection.id),
        localCards,
        status: "expired",
        message: "The Jira credential is unavailable.",
        filter,
      };
    try {
      const client = this.clients.create(
        connection.baseUrl,
        deserializeCredential(storedCredential),
      );
      const [currentUser, issues] = await Promise.all([
        client.getCurrentUser(),
        filter ? client.searchIssues(filter) : client.getAssignedIssues(),
      ]);
      await this.repository.replaceIssues(connection.id, issues);
      return {
        connection,
        currentUser,
        issues,
        localCards,
        status: "connected",
        filter,
      };
    } catch (error) {
      const authenticationFailed =
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        (error.status === 401 || error.status === 403);
      return {
        connection,
        issues: this.repository.listIssues(connection.id),
        localCards,
        status: authenticationFailed ? "expired" : "error",
        message: authenticationFailed
          ? "The Jira credential was rejected or has expired."
          : "Jira could not be reached. Showing locally cached issues.",
        filter,
      };
    }
  }

  public async getIssue(issueKey: string): Promise<JiraIssue> {
    if (!/^[A-Z][A-Z0-9_]{0,19}-[1-9][0-9]{0,9}$/u.test(issueKey))
      throw new Error("Issue key is invalid.");
    const connection = this.repository.getConnection();
    if (!connection) throw new Error("Jira is not connected.");
    const storedCredential = await this.secrets.get(secretKey(connection.id));
    if (!storedCredential) throw new Error("Jira credentials are unavailable.");
    return this.clients
      .create(connection.baseUrl, deserializeCredential(storedCredential))
      .getIssue(issueKey);
  }

  public getIssueUrl(issueKey: string): string {
    if (!/^[A-Z][A-Z0-9_]{0,19}-[1-9][0-9]{0,9}$/u.test(issueKey))
      throw new Error("Issue key is invalid.");
    const connection = this.repository.getConnection();
    if (!connection) throw new Error("Jira is not connected.");
    return new URL(`/browse/${issueKey}`, connection.baseUrl).toString();
  }

  public async search(query: string): Promise<JiraState> {
    const normalized = query.trim();
    if (
      normalized.length === 0 ||
      normalized.length > jiraBoardLimits.filter ||
      /[\r\n\0]/u.test(normalized)
    )
      throw new Error("Jira filter is invalid.");
    const connection = this.repository.getConnection();
    if (!connection) throw new Error("Jira is not connected.");
    const storedCredential = await this.secrets.get(secretKey(connection.id));
    if (!storedCredential) throw new Error("Jira credentials are unavailable.");
    const client = this.clients.create(
      connection.baseUrl,
      deserializeCredential(storedCredential),
    );
    const [currentUser, issues] = await Promise.all([
      client.getCurrentUser(),
      client.searchIssues(normalized),
    ]);
    await this.repository.saveFilter(normalized);
    await this.repository.replaceIssues(connection.id, issues);
    return {
      connection,
      currentUser,
      issues,
      localCards: this.repository.listLocalCards(),
      status: "connected",
      filter: normalized,
    };
  }

  public async createLocalCard(
    summary: string,
    status: JiraBoardStatus,
  ): Promise<void> {
    const normalized = this.validateLocalSummary(summary);
    const now = new Date().toISOString();
    await this.repository.saveLocalCard({
      id: randomUUID(),
      summary: normalized,
      status,
      createdAt: now,
      updatedAt: now,
    });
  }

  public async moveLocalCard(
    id: string,
    status: JiraBoardStatus,
  ): Promise<void> {
    const card = this.repository
      .listLocalCards()
      .find((item) => item.id === id);
    if (!card) throw new Error("Local card was not found.");
    await this.repository.saveLocalCard({
      ...card,
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  public async deleteLocalCard(id: string): Promise<void> {
    await this.repository.deleteLocalCard(id);
  }

  public async disconnect(): Promise<void> {
    this.recentGeneration++;
    this.recentIssues = [];
    this.recentMessage = undefined;
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

  private validateLocalSummary(value: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > jiraBoardLimits.localSummary)
      throw new Error("Local card summary is invalid.");
    return normalized;
  }
}

function hasStatus(error: unknown, ...statuses: readonly number[]): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    statuses.includes(error.status)
  );
}
