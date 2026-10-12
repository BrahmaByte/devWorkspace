import { randomUUID } from "node:crypto";

import type {
  ConfluenceConnection,
  ConfluencePage,
  ConfluenceReaderDocument,
  ConfluenceState,
} from "../../domain/confluence/models";
import type { ConfluenceRepository } from "../../infrastructure/database/confluenceRepository";
import type { SecretStore } from "./jiraService";
import type { Note } from "../../domain/notes/models";
import {
  createAtlassianCredential,
  deserializeCredential,
  isAtlassianCloud,
  serializeCredential,
  type AtlassianCredential,
} from "./atlassianAuth";

export interface ConfluenceClient {
  testConnection(): Promise<void>;
  searchPages(
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly ConfluencePage[]>;
  readPage(
    id: string,
    onContent?: (document: ConfluenceReaderDocument) => void,
  ): Promise<ConfluenceReaderDocument>;
}
export interface ConfluenceClientFactory {
  create(baseUrl: string, credential: AtlassianCredential): ConfluenceClient;
}
export const confluenceLimits = { name: 100, url: 2_000, search: 200 } as const;
const secretKey = (id: string) => `devworkspace.confluence.${id}.pat`;

export class ConfluenceService {
  private readonly readerCache = new Map<
    string,
    { document: ConfluenceReaderDocument; expires: number; bytes: number }
  >();
  private readonly pendingReads = new Map<
    string,
    Promise<ConfluenceReaderDocument>
  >();
  private cacheGeneration = 0;
  private searchSequence = 0;
  private readonly searchCache = new Map<
    string,
    { pages: readonly ConfluencePage[]; expires: number }
  >();
  private readonly pendingSearches = new Map<
    string,
    Promise<readonly ConfluencePage[]>
  >();
  private readonly searchControllers = new Map<string, AbortController>();
  public clearReaderCache(): void {
    this.cacheGeneration++;
    this.searchSequence++;
    this.readerCache.clear();
    this.pendingReads.clear();
    this.searchCache.clear();
    for (const controller of this.searchControllers.values())
      controller.abort();
    this.searchControllers.clear();
    this.pendingSearches.clear();
  }
  public constructor(
    private readonly repository: ConfluenceRepository,
    private readonly secrets: SecretStore,
    private readonly clients: ConfluenceClientFactory,
    private readonly now: () => number = Date.now,
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
    this.clearReaderCache();
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
    this.clearReaderCache();
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
    const sequence = ++this.searchSequence;
    const generation = this.cacheGeneration;
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
    if (generation !== this.cacheGeneration)
      throw new Error("Confluence connection changed. Search again.");
    const key = JSON.stringify([
      connection.id,
      connection.updatedAt,
      normalized,
    ]);
    if (sequence !== this.searchSequence)
      return { connection, pages: [], status: "connected", query: normalized };
    for (const [pendingKey, controller] of this.searchControllers) {
      if (pendingKey !== key) controller.abort();
    }
    const cached = this.searchCache.get(key);
    let pages =
      cached && cached.expires > this.now() ? cached.pages : undefined;
    if (!pages) {
      let pending = this.searchControllers.get(key)?.signal.aborted
        ? undefined
        : this.pendingSearches.get(key);
      if (!pending) {
        const controller = new AbortController();
        pending = this.clients
          .create(connection.baseUrl, deserializeCredential(storedCredential))
          .searchPages(normalized, controller.signal);
        this.pendingSearches.set(key, pending);
        this.searchControllers.set(key, controller);
      }
      try {
        pages = await pending;
      } finally {
        if (this.pendingSearches.get(key) === pending) {
          this.pendingSearches.delete(key);
          this.searchControllers.delete(key);
        }
      }
      if (generation !== this.cacheGeneration)
        throw new Error("Confluence connection changed. Search again.");
      // Metadata only; never persist search terms or page bodies in this cache.
      if (Buffer.byteLength(JSON.stringify(pages), "utf8") <= 100_000) {
        this.searchCache.delete(key);
        this.searchCache.set(key, { pages, expires: this.now() + 60_000 });
        while (this.searchCache.size > 10)
          this.searchCache.delete(this.searchCache.keys().next().value!);
      }
    }
    if (sequence === this.searchSequence)
      await this.repository.replacePages(connection.id, pages);
    return { connection, pages, status: "connected", query: normalized };
  }

  public getPageUrl(id: string, bookmark?: Note): string {
    return this.getPage(id, bookmark).webUrl;
  }

  public getPage(id: string, bookmark?: Note): ConfluencePage {
    const connection = this.repository.getConnection();
    if (!connection)
      throw new Error("Confluence is not connected. Configure it in Settings.");
    let page = !bookmark
      ? this.repository.listPages(connection.id).find((item) => item.id === id)
      : undefined;
    if (bookmark) {
      const lines = bookmark.content.split("\n");
      const ids = lines.filter((line) => line.startsWith("Document ID: "));
      const urls = lines.filter((line) => line.startsWith("URL: "));
      if (
        lines[0] !== "CONFLUENCE REFERENCE BOOKMARK" ||
        ids.length !== 1 ||
        ids[0] !== `Document ID: ${id}` ||
        !/^[0-9A-Za-z_-]{1,100}$/u.test(id) ||
        urls.length !== 1 ||
        !/^https?:\/\//u.test(urls[0]!.slice(5)) ||
        urls[0]!.slice(5).length > confluenceLimits.url
      )
        throw new Error(
          "Confluence bookmark is invalid. Save the page to Notes again.",
        );
      page = {
        id,
        title: bookmark.title,
        webUrl: urls[0]!.slice(5),
        updatedAt: "",
      };
    }
    if (!page) throw new Error("Confluence page was not found.");
    let url: URL;
    try {
      url = new URL(page.webUrl, connection.baseUrl);
    } catch {
      throw new Error(
        "Confluence bookmark URL is invalid. Save the page to Notes again.",
      );
    }
    const base = new URL(connection.baseUrl);
    if (url.origin !== base.origin || url.username || url.password)
      throw new Error(
        "Confluence page URL is not trusted. Connect to the bookmark's original Confluence site in Settings.",
      );
    return { ...page, webUrl: url.toString() };
  }

  public async readPage(
    id: string,
    onContent?: (document: ConfluenceReaderDocument) => void,
    bookmark?: Note,
  ): Promise<ConfluenceReaderDocument> {
    const generation = this.cacheGeneration;
    const page = this.getPage(id, bookmark);
    const connection = this.repository.getConnection();
    if (!connection) throw new Error("Confluence is not connected.");
    const storedCredential = await this.secrets.get(secretKey(connection.id));
    if (!storedCredential)
      throw new Error("Confluence credentials are unavailable.");
    if (generation !== this.cacheGeneration)
      throw new Error("Confluence connection changed. Select the page again.");
    const cacheKey = JSON.stringify([
      connection.id,
      connection.updatedAt,
      connection.baseUrl,
      id,
      page.updatedAt,
    ]);
    const cached = this.readerCache.get(cacheKey);
    if (cached && cached.expires > this.now()) {
      this.readerCache.delete(cacheKey);
      this.readerCache.set(cacheKey, cached);
      return cached.document;
    }
    this.readerCache.delete(cacheKey);
    const pending = this.pendingReads.get(cacheKey);
    if (pending) return pending;
    const load = async (): Promise<ConfluenceReaderDocument> => {
      const document = await this.clients
        .create(connection.baseUrl, deserializeCredential(storedCredential))
        .readPage(id, (content) => {
          if (
            generation !== this.cacheGeneration ||
            content.page.id !== page.id ||
            new URL(content.page.webUrl, connection.baseUrl).origin !==
              new URL(connection.baseUrl).origin
          )
            return;
          onContent?.({
            ...content,
            page: {
              ...content.page,
              webUrl: new URL(
                content.page.webUrl,
                connection.baseUrl,
              ).toString(),
            },
          });
        });
      if (document.page.id !== page.id)
        throw new Error("Confluence returned an unexpected page.");
      const webUrl = new URL(document.page.webUrl, connection.baseUrl);
      if (webUrl.origin !== new URL(connection.baseUrl).origin)
        throw new Error("Confluence page URL is not trusted.");
      const result = {
        ...document,
        page: { ...document.page, webUrl: webUrl.toString() },
      };
      if (generation !== this.cacheGeneration)
        throw new Error(
          "Confluence connection or cache changed. Select the page again.",
        );
      const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
      if (generation === this.cacheGeneration && bytes <= 24_000_000) {
        this.readerCache.set(cacheKey, {
          document: result,
          expires: this.now() + 300_000,
          bytes,
        });
        while (
          this.readerCache.size > 5 ||
          [...this.readerCache.values()].reduce(
            (sum, item) => sum + item.bytes,
            0,
          ) > 24_000_000
        ) {
          const oldest = this.readerCache.keys().next().value;
          if (oldest === undefined) break;
          this.readerCache.delete(oldest);
        }
      }
      return result;
    };
    const promise = load();
    this.pendingReads.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      if (this.pendingReads.get(cacheKey) === promise)
        this.pendingReads.delete(cacheKey);
    }
  }

  public async disconnect(): Promise<void> {
    this.clearReaderCache();
    const connection = this.repository.getConnection();
    if (!connection) return;
    await this.secrets.delete(secretKey(connection.id));
    await this.repository.deleteConnection(connection.id);
    this.clearReaderCache();
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
