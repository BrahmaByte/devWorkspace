// Allowlist diagnostics: never reflect raw errors, URLs, credentials or content.
const HINTS: Record<string, string> = {
  ENOTFOUND: "DNS lookup failed. Check the base URL, proxy host and VPN.",
  EAI_AGAIN: "DNS lookup temporarily failed. Check DNS and VPN.",
  ECONNREFUSED: "Connection refused. Check proxy/server port and availability.",
  ECONNRESET: "Connection reset. Check proxy, VPN and firewall.",
  ETIMEDOUT: "Connection timed out. Check proxy, VPN and firewall.",
  UND_ERR_CONNECT_TIMEOUT:
    "Connection timed out. Check proxy, VPN and firewall.",
  UND_ERR_HEADERS_TIMEOUT:
    "Response timed out. Check proxy/server availability.",
  UND_ERR_BODY_TIMEOUT: "Response body timed out. Check network connectivity.",
  ERR_PROXY_CONNECTION_FAILED:
    "Proxy connection failed. Check proxy settings and corporate sign-in.",
  ERR_TUNNEL_CONNECTION_FAILED:
    "Proxy tunnel failed. Check proxy permissions and corporate sign-in.",
  SELF_SIGNED_CERT_IN_CHAIN:
    "TLS trust failed. Use your IT-approved corporate CA; do not disable verification.",
  DEPTH_ZERO_SELF_SIGNED_CERT:
    "TLS trust failed. Use your IT-approved corporate CA; do not disable verification.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    "TLS trust failed. Check corporate CA and server certificate chain.",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
    "TLS issuer is not trusted. Check corporate CA bundle.",
  CERT_HAS_EXPIRED:
    "TLS certificate expired. Contact proxy/server administrator.",
  ERR_TLS_CERT_ALTNAME_INVALID:
    "TLS hostname mismatch. Check URL and proxy certificate.",
};

export function networkDiagnosticHint(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof current !== "object" || current === null) break;
    if ("status" in current) {
      if (current.status === 407)
        return "HTTP 407: Proxy authentication rejected. Check proxy credentials; extension-only proxy supports Basic authentication.";
      if (current.status === 401 || current.status === 403)
        return "Provider authentication/permission rejected. Check Jira/Confluence credentials and permissions, not proxy credentials.";
      if (current.status === 404)
        return "HTTP 404: API endpoint not found. Check product base URL and proxy routing.";
      if (current.status === 429)
        return "HTTP 429: Rate limited. Wait before retrying.";
      if (
        typeof current.status === "number" &&
        current.status >= 500 &&
        current.status <= 599
      )
        return "Server/proxy error. Check availability with your administrator.";
    }
    if (
      "code" in current &&
      typeof current.code === "string" &&
      Object.hasOwn(HINTS, current.code)
    )
      return `${current.code}: ${HINTS[current.code]}`;
    if (current instanceof Error && current.name === "TimeoutError")
      return "Request timed out. Check proxy, VPN and firewall.";
    if (current instanceof Error && current.name === "AbortError")
      return "Request cancelled. Retry only when ready.";
    current = "cause" in current ? current.cause : undefined;
  }
  return "No safe diagnostic code available. Check base URL, proxy, VPN, TLS trust and server availability.";
}
