export type IntegrationProvider = "jira" | "confluence";

export class ProxyTunnelError extends Error {
  public constructor(public readonly status: number) {
    super("Proxy CONNECT tunnel rejected.");
  }
}

export function proxyTunnelErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof ProxyTunnelError)) return undefined;
  const status = error.status;
  if (!Number.isInteger(status) || status < 100 || status > 599)
    return "Proxy CONNECT tunnel failed. Check proxy configuration with your IT team.";
  let hint =
    "Check proxy configuration and destination access with your IT team.";
  if (status === 407)
    hint =
      "Proxy authentication rejected. Check proxy credentials; extension-only proxy supports Basic authentication, not NTLM/Kerberos/SSO. Use VS Code's managed proxy for corporate sign-in.";
  else if (status === 401 || status === 403)
    hint =
      "Proxy access denied, not a provider credential error. Check corporate sign-in and permission to CONNECT to the destination on port 443.";
  else if (status >= 300 && status < 400)
    hint =
      "Proxy redirected the tunnel, possibly to a sign-in page. Check the proxy endpoint and corporate sign-in; CONNECT redirects are not followed.";
  else if (status === 502 || status === 504)
    hint =
      "Proxy reported an upstream destination failure; this status alone does not identify the cause. Compare proxy routing/PAC/bypass rules and authentication with the working browser. Check proxy-side DNS, VPN, firewall and server availability with IT; extension-only mode supports Basic authentication only.";
  else if (status >= 500)
    hint =
      "Proxy server failed. Contact your proxy administrator; no direct fallback was attempted.";
  else if (status === 400 || status === 404 || status === 405)
    hint =
      "Proxy endpoint rejected CONNECT. Check proxy URL/port and HTTPS tunneling support.";
  else if (status === 429)
    hint =
      "Proxy rate limited the tunnel. Wait before retrying; there is no automatic retry.";
  return `Proxy CONNECT rejected (HTTP ${status}). ${hint}`;
}

export function shouldOfferProxySettings(error: unknown): boolean {
  if (error instanceof ProxyTunnelError) return true;
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? error.status
      : undefined;
  if (typeof status === "number") return status === 407;
  const code = errorCode(error);
  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ERR_PROXY_CONNECTION_FAILED" ||
    code === "ERR_TUNNEL_CONNECTION_FAILED" ||
    (code !== undefined &&
      /CERT|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_SSL/iu.test(code))
  )
    return true;
  return error instanceof TypeError && /fetch failed/iu.test(error.message);
}

export function connectionErrorMessage(
  provider: IntegrationProvider,
  error: unknown,
): string {
  const name = provider === "jira" ? "Jira" : "Confluence";
  const proxyMessage = proxyTunnelErrorMessage(error);
  if (proxyMessage) return `${name}: ${proxyMessage}`;
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? error.status
      : undefined;
  if (status === 401 || status === 403)
    return `${name} rejected the credential. For Atlassian Cloud, check the account email and API token; for Data Center, check the personal access token and permissions.`;
  if (status === 404)
    return `${name} could not find the expected API endpoint. Check the base URL.`;
  if (status === 407)
    return `${name} could not authenticate with the corporate proxy. Check VS Code Proxy Settings or configure Settings → Network proxy for this extension only.`;
  if (status === 429)
    return `${name} temporarily rate-limited the connection test. Wait and try again.`;
  if (typeof status === "number" && status >= 500)
    return `${name} returned a server error (HTTP ${status}). Try again or contact the ${name} administrator.`;
  if (typeof status === "number")
    return `${name} rejected the connection request (HTTP ${status}). Check the base URL and server configuration.`;

  const detail = error instanceof Error ? error.message : "";
  // Only fixed local errors are shown; never expose provider messages or URLs.
  if (provider === "confluence") {
    if (/^Note not found\./u.test(detail))
      return "The Confluence bookmark note no longer exists. Select an existing note.";
    if (/Confluence bookmark (is invalid|URL is invalid)/u.test(detail))
      return "This Confluence bookmark is invalid. Save the page to Notes again.";
    if (/Confluence page URL is not trusted/u.test(detail))
      return "This Confluence reference is outside the connected site. Connect to its original Confluence site in Settings.";
    if (/Confluence page was not found/u.test(detail))
      return "This Confluence page is no longer in the search results. Search again or open its saved bookmark from Notes.";
    if (/Confluence is not connected/u.test(detail))
      return "Confluence is not connected. Configure the bookmark's original site in Settings.";
    if (/Confluence credentials are unavailable/u.test(detail))
      return "Confluence credentials are unavailable. Reconnect in Settings; saved links can still open in the browser.";
    if (/Confluence connection.*changed/u.test(detail))
      return "The Confluence connection changed while loading. Select the page again.";
  }
  if (/must use HTTPS|URL is invalid/iu.test(detail))
    return `Enter a valid HTTPS ${name} base URL. HTTP is allowed only for local development.`;
  if (/Connection name/iu.test(detail))
    return `Enter a valid ${name} connection name.`;
  if (/credential is required|personal access token is required/iu.test(detail))
    return `An Atlassian API token or ${name} personal access token is required.`;
  if (/account email is required/iu.test(detail))
    return `A valid Atlassian account email is required for ${name} Cloud.`;
  const code = errorCode(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return `${name} host name could not be resolved by DNS. Check the base URL, VPN, and VS Code proxy settings.`;
  if (code === "ECONNREFUSED")
    return `${name} refused the connection. Check the base URL, port, VPN, and server availability.`;
  if (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    (error instanceof Error && error.name === "TimeoutError")
  )
    return `${name} connection timed out. Check the VPN, firewall, and VS Code proxy settings.`;
  if (
    code === "ERR_PROXY_CONNECTION_FAILED" ||
    code === "ERR_TUNNEL_CONNECTION_FAILED" ||
    code === "ECONNRESET"
  )
    return `${name} could not pass through the configured proxy. Check the VS Code proxy settings, corporate sign-in, VPN, and firewall.`;
  if (code && /CERT|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_SSL/iu.test(code))
    return `${name} TLS certificate could not be verified. Install the corporate CA in the operating-system trust store and enable VS Code system certificates; DevDashboardV1 will not bypass TLS verification.`;
  if (/outside its trusted origin|too many redirects/iu.test(detail))
    return `${name} redirected the API request unexpectedly. Use the canonical ${name} base URL and verify the corporate proxy or SSO configuration.`;
  return `${name} could not be reached. Check the base URL, VPN, firewall, and VS Code proxy settings.`;
}

function errorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    if ("code" in current && typeof current.code === "string")
      return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}
