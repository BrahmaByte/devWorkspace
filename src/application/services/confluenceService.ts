import { randomUUID } from "node:crypto";

import type {
  ConfluenceConnection,
  ConfluencePage,
  ConfluenceReaderDocument,
  ConfluenceState,
} from "../../domain/confluence/models";
import type { ConfluenceRepository } from "../../infrastructure/database/confluenceRepository";
import type { SecretStore } from "./jiraService";
import {
  createAtlassianCredential,
  deserializeCredential,
  isAtlassianCloud,
  serializeCredential,
  type AtlassianCredential,
} from "./atlassianAuth";

export interface ConfluenceClient {
  testConnection(): Promise<void>;
  searchPages(query: string): Promise<readonly ConfluencePage[]>;
  readPage(id: string): Promise<ConfluenceReaderDocument>;
}
export interface ConfluenceClientFactory {
  create(baseUrl: string, credential: AtlassianCredential): ConfluenceClient;
}
export const confluenceLimits = { name: 100, url: 2_000, search: 200 } as const;
const secretKey = (id: string) => `devworkspace.confluence.${id}.pat`;

export class ConfluenceService {
  public constructor(
    private readonly repository: ConfluenceRepository,
    private readonly secrets: SecretStore,
    private readonly clients: ConfluenceClientFactory,
  ) {}

  public async connect(
    displayName: string,
    baseUrl: string,
    token: string,
    email?: string,
  ): Promise<ConfluenceState> {
    const normalizedUrl = this.validateUrl(baseUrl);
    if (!displayName.trim() || displayName.length > confluenceLimits.name)
      throw new Error("Connection name is invalid.");
    const credential = createAtlassianCredential(normalizedUrl, token, email);
    await this.clients.create(normalizedUrl, credential).testConnection();
    const existing = this.repository.getConnection();
    const now = new Date().toISOString();
    const connection: ConfluenceConnection = {
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
    } catch (error) {
      await this.secrets.delete(secretKey(connection.id));
      throw error;
    }
    return {
      connection,
      pages: this.repository.listPages(connection.id),
      status: "connected",
    };
  }

  public async refresh(): Promise<ConfluenceState> {
    const connection = this.repository.getConnection();
    if (!connection) return { pages: [], status: "disconnected" };
    const pages = this.repository.listPages(connection.id);
    const storedCredential = await this.secrets.get(secretKey(connection.id));
    if (!storedCredential)
      return {
        connection,
        pages,
        status: "expired",
        message: "The Confluence credential is unavailable.",
      };
    try {
      await this.clients
        .create(connection.baseUrl, deserializeCredential(storedCredential))
        .testConnection();
      return { connection, pages, status: "connected" };
    } catch (error) {
      const auth =
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        (error.status === 401 || error.status === 403);
      return {
        connection,
        pages,
        status: auth ? "expired" : "error",
        message: auth
          ? "The Confluence credential was rejected or has expired."
          : "Confluence could not be reached. Showing locally cached page metadata.",
      };
    }
  }

  public async search(query: string): Promise<ConfluenceState> {
    const normalized = query.trim();
    if (
      !normalized ||
      normalized.length > confluenceLimits.search ||
      /[\r\n\0]/u.test(normalized)
    )
      throw new Error("Confluence search is invalid.");
    const connection = this.repository.getConnection();
    if (!connection) throw new Error("Confluence is not connected.");
    const storedCredential = await this.secrets.get(secretKey(connection.id));
    if (!storedCredential)
      throw new Error("Confluence credentials are unavailable.");
    const pages = await this.clients
      .create(connection.baseUrl, deserializeCredential(storedCredential))
      .searchPages(normalized);
    await this.repository.replacePages(connection.id, pages);
    return { connection, pages, status: "connected" };
  }

  public getPageUrl(id: string): string {
    return this.getPage(id).webUrl;
  }

  public getPage(id: string): ConfluencePage {
    const connection = this.repository.getConnection();
    const page = connection
      ? this.repository.listPages(connection.id).find((item) => item.id === id)
      : undefined;
    if (!connection || !page) throw new Error("Confluence page was not found.");
    const url = new URL(page.webUrl, connection.baseUrl);
    if (url.origin !== new URL(connection.baseUrl).origin)
      throw new Error("Confluence page URL is not trusted.");
    return { ...page, webUrl: url.toString() };
  }

  public async readPage(id: string): Promise<ConfluenceReaderDocument> {
    const page = this.getPage(id);
    const connection = this.repository.getConnection();
    if (!connection) throw new Error("Confluence is not connected.");
    const storedCredential = await this.secrets.get(secretKey(connection.id));
    if (!storedCredential)
      throw new Error("Confluence credentials are unavailable.");
    const document = await this.clients
      .create(connection.baseUrl, deserializeCredential(storedCredential))
      .readPage(id);
    if (document.page.id !== page.id)
      throw new Error("Confluence returned an unexpected page.");
    const webUrl = new URL(document.page.webUrl, connection.baseUrl);
    if (webUrl.origin !== new URL(connection.baseUrl).origin)
      throw new Error("Confluence page URL is not trusted.");
    return {
      ...document,
      page: { ...document.page, webUrl: webUrl.toString() },
    };
  }

  public async disconnect(): Promise<void> {
    const connection = this.repository.getConnection();
    if (!connection) return;
    await this.secrets.delete(secretKey(connection.id));
    await this.repository.deleteConnection(connection.id);
  }

  private validateUrl(value: string): string {
    if (!value || value.length > confluenceLimits.url)
      throw new Error("Confluence URL is invalid.");
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    )
      throw new Error("Confluence URL must use HTTPS.");
    url.hash = "";
    url.search = "";
    if (
      isAtlassianCloud(url.toString()) &&
      (url.pathname === "/" || !url.pathname)
    )
      url.pathname = "/wiki";
    return url.toString().replace(/\/$/u, "");
  }
}
