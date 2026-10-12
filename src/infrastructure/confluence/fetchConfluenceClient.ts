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
import { VscodeHttpTransport } from "../http/vscodeHttpTransport";
import { mediaDataUrl } from "./readerMedia";

type JsonRecord = Record<string, unknown>;
export class ConfluenceRequestError extends Error {
  public constructor(public readonly status: number) {
    super(`Confluence request failed (${status}).`);
  }
}
export class FetchConfluenceClientFactory implements ConfluenceClientFactory {
  public constructor(
    private readonly transport: VscodeHttpTransport = new VscodeHttpTransport(),
  ) {}

  public create(
    baseUrl: string,
    credential: AtlassianCredential,
  ): ConfluenceClient {
    return new FetchConfluenceClient(baseUrl, credential, this.transport);
  }
}
export class FetchConfluenceClient implements ConfluenceClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly credential: AtlassianCredential,
    private readonly transport: VscodeHttpTransport = new VscodeHttpTransport(),
  ) {}
  public async testConnection(): Promise<void> {
    await this.request("/rest/api/user/current");
  }
  public async searchPages(
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly ConfluencePage[]> {
    const escaped = query.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
    const parameters = new URLSearchParams({
      cql: `type=page AND text ~ "${escaped}"`,
      limit: "25",
      expand: "space,version",
    });
    const data = await this.request(
      `/rest/api/content/search?${parameters.toString()}`,
      signal,
    );
    if (!Array.isArray(data.results))
      throw new Error("Invalid Confluence response.");
    return data.results.map(toPage);
  }
  public async readPage(
    id: string,
    onContent?: (document: ConfluenceReaderDocument) => void,
  ): Promise<ConfluenceReaderDocument> {
    if (!/^[0-9A-Za-z_-]{1,100}$/u.test(id))
      throw new Error("Invalid Confluence page identifier.");
    let data = await this.request(
      `/rest/api/content/${encodeURIComponent(id)}?expand=body.export_view,space,version,history,metadata.labels`,
    );
    let body = isRecord(data.body) ? data.body : undefined;
    if (
      !body ||
      ![body.export_view, body.view].some(
        (value) =>
          isRecord(value) &&
          typeof value.value === "string" &&
          value.value.trim(),
      )
    ) {
      data = await this.request(
        `/rest/api/content/${encodeURIComponent(id)}?expand=body.view,space,version,history,metadata.labels`,
      );
      body = isRecord(data.body) ? data.body : undefined;
    }
    const view =
      body &&
      isRecord(body.export_view) &&
      typeof body.export_view.value === "string" &&
      body.export_view.value.trim()
        ? body.export_view
        : body && isRecord(body.view)
          ? body.view
          : undefined;
    if (!view || typeof view.value !== "string")
      throw new Error("Confluence page body is unavailable.");
    const sources: Array<{
      id: string;
      url: string;
      alt: string;
      inline?: string;
    }> = [];
    const warnings: string[] = [];
    let sourceHtml = view.value;
    if (
      /<(?:script|iframe|object|embed)\b|data-macro-name\s*=\s*["'](?:jira|widget|include|excerpt-include)["']/iu.test(
        sourceHtml,
      )
    )
      warnings.push(
        "Some interactive or unresolved macros may be unavailable. Open the original page in your browser for the complete view.",
      );
    sourceHtml = sourceHtml.replace(
      /<(iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>|<embed\b[^>]*>/giu,
      "<p>Interactive macro unavailable in the reader. Open the original page in your browser.</p>",
    );
    const inline = new Map<string, string>();
    sourceHtml = sourceHtml.replace(
      /<svg\b[^>]*>[\s\S]*?<\/svg\s*>/giu,
      (svg) => {
        const key = `reader-inline:${inline.size}`;
        try {
          inline.set(key, mediaDataUrl(Buffer.from(svg), "image/svg+xml"));
          return `<img src="${key}" alt="Diagram">`;
        } catch {
          warnings.push(
            "An active or unsupported embedded diagram was blocked.",
          );
          return "<p>Diagram unavailable. Open the original page to view this macro.</p>";
        }
      },
    );
    const sanitized = sanitizeConfluenceHtml(sourceHtml, (src, alt) => {
      if (!src.trim()) return undefined;
      let inlineData = inline.get(src);
      const embedded =
        /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/u.exec(
          src,
        );
      if (embedded) {
        if (src.length > 2_700_000) return undefined;
        try {
          inlineData = mediaDataUrl(
            Buffer.from(embedded[2] ?? "", "base64"),
            embedded[1] ?? "",
          );
        } catch {
          warnings.push("An invalid embedded image was blocked.");
          return undefined;
        }
      } else if (src.length > 4000) return undefined;
      if (sources.length >= 20) {
        warnings.push("Additional images were omitted (20-image limit).");
        return undefined;
      }
      let url: URL;
      try {
        url = new URL(src, this.baseUrl + "/");
      } catch {
        return undefined;
      }
      if (
        !inlineData &&
        (url.origin !== new URL(this.baseUrl).origin ||
          url.username ||
          url.password ||
          url.protocol !== "https:")
      ) {
        warnings.push("An external image was blocked for privacy.");
        return undefined;
      }
      const existing = sources.find((source) => source.url === url.toString());
      if (existing) return existing.id;
      const mediaId = `reader-media-${sources.length + 1}`;
      sources.push({
        id: mediaId,
        url: url.toString(),
        alt,
        ...(inlineData ? { inline: inlineData } : {}),
      });
      return mediaId;
    });
    const space = isRecord(data.space) ? data.space : {};
    const version = isRecord(data.version) ? data.version : {};
    const history = isRecord(data.history) ? data.history : {};
    const metadata = isRecord(data.metadata) ? data.metadata : {};
    const labels =
      isRecord(metadata.labels) && Array.isArray(metadata.labels.results)
        ? metadata.labels.results
            .filter(isRecord)
            .flatMap((label) =>
              typeof label.name === "string" ? [label.name] : [],
            )
            .slice(0, 50)
        : [];
    const document: ConfluenceReaderDocument = {
      page: toPage(data),
      ...sanitized,
      metadata: {
        ...(typeof space.key === "string" ? { spaceKey: space.key } : {}),
        ...(typeof version.number === "number"
          ? { version: version.number }
          : {}),
        ...(typeof data.status === "string" ? { status: data.status } : {}),
        ...(isRecord(history.createdBy) &&
        typeof history.createdBy.displayName === "string"
          ? { createdBy: history.createdBy.displayName }
          : {}),
        ...(isRecord(version.by) && typeof version.by.displayName === "string"
          ? { updatedBy: version.by.displayName }
          : {}),
        ...(typeof history.createdDate === "string"
          ? { createdAt: history.createdDate }
          : {}),
        labels,
      },
    };
    if (sources.length) onContent?.({ ...document, mediaLoading: true });
    const media: NonNullable<ConfluenceReaderDocument["media"]>[number][] = [];
    const deadline = AbortSignal.timeout(20_000);
    let total = 0;
    // Four simultaneous downloads avoid serial round trips without flooding the proxy.
    for (let start = 0; start < sources.length; start += 4) {
      const batch = await Promise.all(
        sources.slice(start, start + 4).map(async (source) => {
          try {
            const dataUrl =
              source.inline ?? (await this.readMedia(source.url, deadline));
            return { id: source.id, alt: source.alt, dataUrl };
          } catch {
            warnings.push(
              "An image or diagram could not be loaded. Open the original page if needed.",
            );
            return undefined;
          }
        }),
      );
      for (const item of batch) {
        if (!item) continue;
        if (total + item.dataUrl.length > 8_000_000) {
          warnings.push("Additional images were omitted (page media limit).");
          continue;
        }
        total += item.dataUrl.length;
        media.push(item);
      }
      if (deadline.aborted || total >= 8_000_000) break;
    }
    return { ...document, media, mediaWarnings: [...new Set(warnings)] };
  }
  private async readMedia(url: string, signal: AbortSignal): Promise<string> {
    const response = await this.transport.fetch(
      url,
      {
        signal,
        headers: {
          Authorization: authorizationHeader(this.credential),
          Accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml",
        },
      },
      ["api.media.atlassian.com"],
    );
    if (!response.ok) throw new ConfluenceRequestError(response.status);
    if (Number(response.headers.get("content-length") ?? 0) > 2_000_000)
      throw new Error("Image too large.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty media response.");
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > 2_000_000) throw new Error("Image too large.");
        chunks.push(result.value);
      }
    } finally {
      await reader.cancel();
    }
    return mediaDataUrl(
      Buffer.concat(chunks),
      response.headers.get("content-type") ?? "",
    );
  }
  private async request(
    path: string,
    signal?: AbortSignal,
  ): Promise<JsonRecord> {
    const response = await this.transport.fetch(`${this.baseUrl}${path}`, {
      ...(signal ? { signal } : {}),
      headers: {
        Accept: "application/json",
        Authorization: authorizationHeader(this.credential),
      },
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
  "div",
  "span",
  "details",
  "summary",
  "dl",
  "dt",
  "dd",
  "figure",
  "figcaption",
  "caption",
  "tfoot",
  "sub",
  "sup",
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

export function sanitizeConfluenceHtml(
  value: string,
  image?: (src: string, alt: string) => string | undefined,
): {
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
      if (tag === "img" && !match[1] && image) {
        const attrs: Record<string, string> = {};
        for (const attribute of token.matchAll(
          /\s(src|alt)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu,
        ))
          attrs[attribute[1]?.toLowerCase() ?? ""] = decodeEntities(
            attribute[2] ?? attribute[3] ?? attribute[4] ?? "",
          );
        const mediaId = image(
          attrs.src ?? "",
          (attrs.alt ?? "Image").slice(0, 300),
        );
        return mediaId && /^reader-media-\d+$/u.test(mediaId)
          ? `<img data-reader-media="${mediaId}">`
          : "";
      }
      if (!allowedTags.has(tag)) return "";
      if (match[1]) return voidTags.has(tag) ? "" : `</${tag}>`;
      if (tag === "div" || tag === "span") {
        const classes = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(token);
        const known = (classes?.[1] ?? classes?.[2] ?? "").split(/\s+/u);
        const kind =
          known.includes("confluence-information-macro") ||
          known.includes("panel")
            ? "panel"
            : known.includes("status-macro")
              ? "status"
              : known.includes("code")
                ? "code"
                : undefined;
        return `<${tag}${kind ? ` class="reader-macro-${kind}"` : ""}>`;
      }
      if (tag === "td" || tag === "th") {
        const spans: string[] = [];
        for (const attribute of token.matchAll(
          /\s(colspan|rowspan)\s*=\s*(?:"([0-9]+)"|'([0-9]+)'|([0-9]+))/giu,
        )) {
          const count = Number(attribute[2] ?? attribute[3] ?? attribute[4]);
          if (count > 0 && count < 100)
            spans.push(`${attribute[1]?.toLowerCase()}="${count}"`);
        }
        return `<${tag}${spans.length ? " " + spans.join(" ") : ""}>`;
      }
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
      if (key.startsWith("#")) {
        const code = key.toLowerCase().startsWith("#x")
          ? Number.parseInt(key.slice(2), 16)
          : Number.parseInt(key.slice(1), 10);
        return code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : "\ufffd";
      }
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
