import type {
  ConfluenceClient,
  ConfluenceClientFactory,
} from "../../application/services/confluenceService";
import type { ConfluencePage } from "../../domain/confluence/models";
import {
  authorizationHeader,
  type AtlassianCredential,
} from "../../application/services/atlassianAuth";

type JsonRecord = Record<string, unknown>;
export class ConfluenceRequestError extends Error {
  public constructor(public readonly status: number) {
    super(`Confluence request failed (${status}).`);
  }
}
export class FetchConfluenceClientFactory implements ConfluenceClientFactory {
  public create(
    baseUrl: string,
    credential: AtlassianCredential,
  ): ConfluenceClient {
    return new FetchConfluenceClient(baseUrl, credential);
  }
}
export class FetchConfluenceClient implements ConfluenceClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly credential: AtlassianCredential,
  ) {}
  public async testConnection(): Promise<void> {
    await this.request("/rest/api/user/current");
  }
  public async searchPages(query: string): Promise<readonly ConfluencePage[]> {
    const escaped = query.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
    const parameters = new URLSearchParams({
      cql: `type=page AND siteSearch ~ "${escaped}"`,
      limit: "25",
      expand: "space,version",
    });
    const data = await this.request(
      `/rest/api/content/search?${parameters.toString()}`,
    );
    if (!Array.isArray(data.results))
      throw new Error("Invalid Confluence response.");
    return data.results.map(toPage);
  }
  private async request(path: string): Promise<JsonRecord> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: authorizationHeader(this.credential),
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new ConfluenceRequestError(response.status);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > 2_000_000)
      throw new Error("Confluence response is too large.");
    const body = await response.text();
    if (body.length > 2_000_000)
      throw new Error("Confluence response is too large.");
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed)) throw new Error("Invalid Confluence response.");
    return parsed;
  }
}
function toPage(value: unknown): ConfluencePage {
  if (!isRecord(value)) throw new Error("Invalid Confluence page.");
  const links = isRecord(value._links)
    ? value._links
    : isRecord(value.links)
      ? value.links
      : {};
  const space = isRecord(value.space) ? value.space : undefined;
  const version = isRecord(value.version) ? value.version : undefined;
  return {
    id: requiredString(value.id),
    title: requiredString(value.title),
    ...(space && typeof space.name === "string"
      ? { spaceName: space.name }
      : {}),
    webUrl: requiredString(links.webui),
    updatedAt:
      version && typeof version.when === "string"
        ? version.when
        : new Date(0).toISOString(),
  };
}
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 100_000)
    throw new Error("Invalid Confluence response.");
  return value;
}
