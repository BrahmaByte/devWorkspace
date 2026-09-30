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
    return `${name} rejected the personal access token. Check that it is valid and has the required permissions.`;
  if (status === 404)
    return `${name} could not find the expected API endpoint. Check the base URL.`;

  const detail = error instanceof Error ? error.message : "";
  if (/must use HTTPS|URL is invalid/iu.test(detail))
    return `Enter a valid HTTPS ${name} base URL. HTTP is allowed only for local development.`;
  if (/Connection name/iu.test(detail))
    return `Enter a valid ${name} connection name.`;
  if (/personal access token is required/iu.test(detail))
    return `A ${name} personal access token is required.`;
  return `${name} could not be reached. Check the base URL, network access, TLS certificate, and personal access token.`;
}
