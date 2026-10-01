import type {
  ConfluenceClient,
  ConfluenceClientFactory,
} from "../../application/services/confluenceService";
import type {
  ConfluencePage,
  ConfluenceReaderDocument,
  ConfluenceReaderHeading,
} from "../../domain/confluence/models";
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
  public async readPage(id: string): Promise<ConfluenceReaderDocument> {
    if (!/^[0-9A-Za-z_-]{1,100}$/u.test(id))
      throw new Error("Invalid Confluence page identifier.");
    const data = await this.request(
      `/rest/api/content/${encodeURIComponent(id)}?expand=body.view,space,version`,
    );
    const body = isRecord(data.body) ? data.body : undefined;
    const view = body && isRecord(body.view) ? body.view : undefined;
    if (!view || typeof view.value !== "string")
      throw new Error("Confluence page body is unavailable.");
    const sanitized = sanitizeConfluenceHtml(view.value);
    return { page: toPage(data), ...sanitized };
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

const allowedTags = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
const voidTags = new Set(["br", "hr"]);

export function sanitizeConfluenceHtml(value: string): {
  readonly html: string;
  readonly headings: readonly ConfluenceReaderHeading[];
} {
  const withoutActiveContent = value
    .replace(
      /<(script|style|iframe|object|embed|form|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
      "",
    )
    .replace(/<!--?[\s\S]*?-->/gu, "");
  const tokens = withoutActiveContent.match(/<[^>]*>|[^<]+/gu) ?? [];
  const safe = tokens
    .map((token) => {
      if (!token.startsWith("<")) return token;
      const match = /^<\s*(\/)?\s*([a-z][a-z0-9]*)\b[^>]*>$/iu.exec(token);
      if (!match) return "";
      const tag = match[2]?.toLowerCase() ?? "";
      if (!allowedTags.has(tag)) return "";
      if (match[1]) return voidTags.has(tag) ? "" : `</${tag}>`;
      return `<${tag}>`;
    })
    .join("");
  const headings: ConfluenceReaderHeading[] = [];
  let index = 0;
  const html = safe.replace(
    /<h([1-6])>([\s\S]*?)<\/h\1>/giu,
    (_whole, level: string, content: string) => {
      const text = decodeEntities(content.replace(/<[^>]+>/gu, " "))
        .replace(/\s+/gu, " ")
        .trim();
      const id = `reader-section-${++index}`;
      headings.push({
        id,
        level: Number(level),
        text: text || `Section ${index}`,
      });
      return `<h${level} data-reader-id="${id}">${content}</h${level}>`;
    },
  );
  return { html, headings };
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/giu,
    (entity, key: string) => {
      if (key.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
      if (key.startsWith("#"))
        return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
      return named[key.toLowerCase()] ?? entity;
    },
  );
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
