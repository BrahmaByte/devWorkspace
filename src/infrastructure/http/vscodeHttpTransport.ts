export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;

export class UnsafeNetworkRedirectError extends Error {
  public constructor() {
    super("The server redirected the request outside its trusted origin.");
  }
}

/**
 * Uses the fetch implementation patched by the VS Code extension host. That
 * implementation observes VS Code's proxy, proxy authentication, no-proxy,
 * and system-certificate settings on supported desktop hosts.
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
