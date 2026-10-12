import { request as httpsRequest } from "node:https";

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Uses the Node HTTPS API patched by VS Code's extension host proxy support. */
export function createVscodeHttpsFetch(
  request: typeof httpsRequest = httpsRequest,
): FetchImplementation {
  return (input, init = {}) =>
    new Promise<Response>((resolve, reject) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (new URL(url).protocol !== "https:") {
        reject(new Error("Integration requests require HTTPS."));
        return;
      }
      const signal = init.signal;
      if (signal?.aborted) {
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException("The request was aborted.", "AbortError"),
        );
        return;
      }
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      const requestBody = init.body;
      if (
        requestBody !== undefined &&
        requestBody !== null &&
        typeof requestBody !== "string" &&
        !(requestBody instanceof Uint8Array) &&
        !(requestBody instanceof ArrayBuffer)
      ) {
        reject(new Error("Unsupported integration request body."));
        return;
      }
      const body =
        requestBody instanceof ArrayBuffer
          ? new Uint8Array(requestBody)
          : requestBody;
      if (body !== undefined && body !== null && !("content-length" in headers))
        headers["content-length"] = String(
          typeof body === "string" ? Buffer.byteLength(body) : body.byteLength,
        );
      let responseReceived = false,
        settled = false;
      const outgoing = request(
        url,
        { method: init.method ?? "GET", headers },
        (incoming) => {
          responseReceived = true;
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value))
              for (const item of value) responseHeaders.append(name, item);
            else if (value !== undefined) responseHeaders.set(name, value);
          }
          const status = incoming.statusCode ?? 500;
          const chunks: Buffer[] = [];
          let size = 0,
            ended = false;
          const fail = (error: Error): void => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
          };
          incoming.on("data", (chunk: Buffer | Uint8Array | string) => {
            const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += value.length;
            if (size > 16_000_000) {
              const error = new Error(
                "Integration response exceeds the size limit.",
              );
              incoming.destroy(error);
              fail(error);
              return;
            }
            chunks.push(value);
          });
          incoming.once("end", () => {
            ended = true;
            if (settled) return;
            settled = true;
            cleanup();
            resolve(
              new Response(
                [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
                {
                  status,
                  statusText: incoming.statusMessage,
                  headers: responseHeaders,
                },
              ),
            );
          });
          incoming.once("aborted", () =>
            fail(new Error("Integration response was aborted.")),
          );
          incoming.once("error", fail);
          incoming.once("close", () => {
            if (!ended)
              fail(new Error("Integration response closed before completion."));
          });
        },
      );
      const abort = (): void => {
        outgoing.destroy(
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException("The request was aborted.", "AbortError"),
        );
      };
      const cleanup = (): void => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      outgoing.once("close", () => {
        if (!responseReceived) cleanup();
      });
      outgoing.once("error", (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });
      if (body !== undefined && body !== null) outgoing.write(body);
      outgoing.end();
    });
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;

export class UnsafeNetworkRedirectError extends Error {
  public constructor() {
    super("The server redirected the request outside its trusted origin.");
  }
}

/**
 * Applies bounded redirects and credential stripping around the selected host
 * transport.
 */
export class VscodeHttpTransport {
  public constructor(
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch.bind(
      globalThis,
    ),
  ) {}

  public async fetch(
    url: string,
    init: RequestInit = {},
    publicMediaRedirectHosts: readonly string[] = [],
  ): Promise<Response> {
    const trustedOrigin = new URL(url).origin;
    let currentUrl = url;
    let currentInit = init;

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await this.fetchImplementation(currentUrl, {
        ...currentInit,
        redirect: "manual",
        signal: init.signal
          ? AbortSignal.any([
              init.signal,
              AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            ])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!REDIRECT_STATUSES.has(response.status)) return response;

      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS)
        throw new Error("The server returned too many redirects.");
      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.origin !== trustedOrigin) {
        if (
          nextUrl.protocol !== "https:" ||
          nextUrl.username ||
          nextUrl.password ||
          !publicMediaRedirectHosts.includes(nextUrl.hostname)
        )
          throw new UnsafeNetworkRedirectError();
        const headers = new Headers(currentInit.headers);
        for (const name of ["authorization", "cookie", "proxy-authorization"])
          headers.delete(name);
        currentInit = { ...currentInit, headers };
      }

      const method = (currentInit.method ?? "GET").toUpperCase();
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method === "GET")
      ) {
        currentInit = { ...currentInit, method: "GET", body: undefined };
      }
      currentUrl = nextUrl.toString();
    }
    throw new Error("The server returned too many redirects.");
  }
}
