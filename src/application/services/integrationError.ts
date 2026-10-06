export type IntegrationProvider = "jira" | "confluence";

export function shouldOfferProxySettings(error: unknown): boolean {
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
