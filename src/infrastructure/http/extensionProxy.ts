import {
  rootCertificates,
  createSecureContext,
  getCACertificates,
} from "node:tls";
import { X509Certificate } from "node:crypto";
import { ProxyAgent, fetch as proxyFetch } from "undici";
import type { FetchImplementation } from "./vscodeHttpTransport";
import { networkDiagnosticHint } from "./networkDiagnostics";

export interface ExtensionProxyConfig {
  readonly url: string;
  readonly username?: string;
  readonly password?: string;
  readonly ca?: string;
}

export function validateProxyUrl(value: string): string {
  const invalid = () =>
    new Error(
      "Enter an HTTP or HTTPS proxy URL without credentials, path, query, or fragment.",
    );
  if (value.length > 2000 || /[\s\0]/u.test(value)) throw invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw invalid();
  return url.origin;
}

export function validateProxyCa(ca: string): void {
  if (
    ca.length > 1_000_000 ||
    !ca.includes("-----BEGIN CERTIFICATE-----") ||
    ca.includes("PRIVATE KEY")
  )
    throw new Error("Choose a PEM CA certificate bundle, not a private key.");
  createSecureContext({ ca });
  const certificates = ca.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu,
  );
  if (!certificates?.length) throw new Error("Invalid PEM CA bundle.");
  for (const certificate of certificates) new X509Certificate(certificate);
}

/** Explicit per-request dispatcher: never mutates VS Code's global networking. */
export function createExtensionProxyFetch(
  load: () => Promise<ExtensionProxyConfig | undefined>,
  defaultFetch: FetchImplementation,
  log?: (message: string) => void,
): FetchImplementation {
  let sequence = 0;
  return async (input, init) => {
    const id = ++sequence;
    const started = Date.now();
    const write = (message: string): void =>
      log?.(`[request ${id}] ${message}`);
    const request = async (): Promise<Response> => {
      const config = await load();
      if (!config) {
        write(
          "Network route: delegated to VS Code network settings (proxy/direct selection managed by VS Code).",
        );
        return defaultFetch(input, init);
      }
      const uri = validateProxyUrl(config.url);
      write(
        `Network route: extension-only ${new URL(uri).protocol === "https:" ? "HTTPS" : "HTTP"} proxy; Basic authentication=${Boolean(config.username)}; custom CA=${Boolean(config.ca)}; TLS verification enabled; no direct fallback.`,
      );
      if (config.ca) validateProxyCa(config.ca);
      const trustedCAs =
        typeof getCACertificates === "function"
          ? [...getCACertificates("default"), ...getCACertificates("system")]
          : undefined;
      const tls = {
        rejectUnauthorized: true,
        ...(config.ca || trustedCAs
          ? {
              ca: [
                ...(trustedCAs ?? rootCertificates),
                ...(config.ca ? [config.ca] : []),
              ],
            }
          : {}),
      };
      const agent = new ProxyAgent({
        uri,
        requestTls: tls,
        proxyTls: tls,
        ...(config.username
          ? {
              token:
                "Basic " +
                Buffer.from(
                  config.username + ":" + (config.password ?? ""),
                ).toString("base64"),
            }
          : {}),
      });
      try {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (new URL(url).protocol !== "https:")
          throw new Error("Integration requests require HTTPS.");
        const response = await proxyFetch(url, {
          ...init,
          dispatcher: agent,
        } as Parameters<typeof proxyFetch>[1]);
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (response.body)
          for await (const chunk of response.body) {
            if (!(chunk instanceof Uint8Array))
              throw new Error("Invalid response body.");
            size += chunk.byteLength;
            if (size > 16 * 1024 * 1024)
              throw new Error("Integration response exceeds the size limit.");
            chunks.push(chunk);
          }
        const headers = new Headers();
        response.headers.forEach((value, key) => headers.set(key, value));
        return new Response(
          [204, 205, 304].includes(response.status)
            ? null
            : Buffer.concat(chunks),
          { status: response.status, statusText: response.statusText, headers },
        );
      } catch (error) {
        let cause: unknown = error;
        for (let depth = 0; depth < 4 && cause instanceof Error; depth++) {
          if (/Proxy response \(407\)/u.test(cause.message))
            throw Object.assign(new Error("Proxy authentication required."), {
              status: 407,
            });
          cause = cause.cause;
        }
        throw error;
      } finally {
        await agent.destroy();
      }
    };
    write("Request started (URLs, headers, credentials and content omitted).");
    try {
      const response = await request();
      write(`HTTP ${response.status}; elapsed ${Date.now() - started} ms.`);
      if (response.status >= 400)
        write(networkDiagnosticHint({ status: response.status }));
      if (response.status >= 300 && response.status < 400)
        write(
          "Redirect received; transport permits only trusted destinations. Check canonical URL or SSO routing if connection fails.",
        );
      return response;
    } catch (error) {
      write(
        `Request failed; elapsed ${Date.now() - started} ms. ${networkDiagnosticHint(error)}`,
      );
      throw error;
    }
  };
}
