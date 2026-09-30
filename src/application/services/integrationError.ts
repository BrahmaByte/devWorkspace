export type IntegrationProvider = "jira" | "confluence";

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
    return `${name} host name could not be resolved. Check the base URL, DNS, and VPN connection.`;
  if (code === "ECONNREFUSED")
    return `${name} refused the connection. Check the base URL, port, VPN, and server availability.`;
  if (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    (error instanceof Error && error.name === "TimeoutError")
  )
    return `${name} connection timed out. Check the VPN, proxy, firewall, and server availability.`;
  if (code && /CERT|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_SSL/iu.test(code))
    return `${name} TLS certificate could not be verified. Ask an administrator to configure a trusted certificate or CA; DevDashboard will not bypass TLS verification.`;
  return `${name} could not be reached. Check the base URL, VPN, proxy, firewall, and server availability.`;
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
