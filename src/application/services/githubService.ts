import { createHash } from "node:crypto";
import {
  githubOwner,
  githubRepositoryId,
  type GitHubRepository,
  type GitHubState,
} from "../../domain/github";
import type { VscodeHttpTransport } from "../../infrastructure/http/vscodeHttpTransport";
import { networkDiagnosticHint } from "../../infrastructure/http/networkDiagnostics";
import { proxyTunnelErrorMessage } from "./integrationError";

export const githubSecretKey = "integrations.github.pat";
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
interface Secrets {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}
export class GitHubError extends Error {
  public constructor(
    message: string,
    public readonly status = 0,
  ) {
    super(message);
  }
}
function githubResponseError(response: Response): GitHubError {
  const status = response.status;
  const fromGitHub =
    response.headers.has("x-github-request-id") ||
    response.headers.has("x-github-media-type");
  if (status === 407)
    return new GitHubError(
      "The corporate proxy rejected authentication for the GitHub API. Check the system or VS Code proxy sign-in and retry.",
    );
  if (!fromGitHub) {
    if (status === 401 || status === 403)
      return new GitHubError(
        `A network proxy or security gateway blocked the GitHub API request (HTTP ${status}). GitHub did not identify this as a PAT rejection. Check access to api.github.com with your IT team.`,
      );
    if (status === 429)
      return new GitHubError(
        "A network proxy or security gateway rate-limited the GitHub API request. Wait or check the corporate route to api.github.com.",
      );
    if ([502, 503, 504].includes(status))
      return new GitHubError(
        `The network proxy or security gateway could not reach the GitHub API (HTTP ${status}). Check VPN, DNS and api.github.com access with your IT team.`,
      );
  }
  if (status === 401)
    return new GitHubError(
      "GitHub rejected the PAT. Update it in Settings.",
      401,
    );
  if (status === 403) {
    if (response.headers.get("x-ratelimit-remaining") === "0")
      return new GitHubError(
        "GitHub API rate limit reached. Wait until the limit resets, then retry.",
        429,
      );
    if (/\brequired\b/iu.test(response.headers.get("x-github-sso") ?? ""))
      return new GitHubError(
        "GitHub requires organization SSO authorization for this PAT. Authorize the PAT for the organization, then retry.",
        403,
      );
    return new GitHubError(
      "GitHub denied access. Check PAT permissions, organization policy and SSO authorization.",
      403,
    );
  }
  if (status === 429)
    return new GitHubError(
      "GitHub API rate limit reached. Wait until the limit resets, then retry.",
      429,
    );
  return new GitHubError(
    `GitHub request failed (HTTP ${status}). Check repository access and retry when ready.`,
    status,
  );
}
export class GitHubService {
  private generation = 0;
  private login = "";
  private organizations: string[] = [];
  private owner = "";
  private repositories: GitHubRepository[] = [];
  private nextPage = 0;
  private notice = "";
  private loadedAt = 0;
  private credentialHash = "";
  public constructor(
    private readonly secrets: Secrets,
    private readonly http: Pick<VscodeHttpTransport, "fetch">,
  ) {}
  private clear(): void {
    this.generation++;
    this.login = this.owner = this.notice = "";
    this.organizations = [];
    this.repositories = [];
    this.nextPage = this.loadedAt = 0;
    this.credentialHash = "";
  }
  public async state(message = this.notice): Promise<GitHubState> {
    const token = await this.secrets.get(githubSecretKey);
    if (
      this.credentialHash &&
      (!token || this.credentialHash !== this.hash(token))
    ) {
      this.clear();
      message = "GitHub connection changed. Refresh repositories.";
    }
    return {
      connected: !!token,
      login: this.login,
      organizations: this.organizations,
      owner: this.owner,
      repositories: this.repositories,
      hasMore: this.nextPage > 0,
      message,
    };
  }
  private async json(path: string, token: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.http.fetch("https://api.github.com" + path, {
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "DevDashboardV1",
        },
      });
    } catch (error) {
      const proxy = proxyTunnelErrorMessage(error);
      throw new GitHubError(
        proxy
          ? `GitHub: ${proxy}`
          : "GitHub API could not be reached through the same system or VS Code proxy route used by Jira and Confluence. " +
              networkDiagnosticHint(error),
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw githubResponseError(response);
    }
    // Bound response content before JSON parsing; raw bodies/errors never cross the Webview.
    const reader = response.body?.getReader();
    if (!reader) throw new GitHubError("GitHub returned an empty response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 2_000_000)
          throw new GitHubError(
            "GitHub response is too large. Narrow repository access and retry.",
          );
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      throw new GitHubError("GitHub returned an invalid response.");
    } finally {
      await reader.cancel();
    }
  }
  private async token(): Promise<string> {
    const token = await this.secrets.get(githubSecretKey);
    if (!token) throw new GitHubError("Connect GitHub in Settings first.");
    return token;
  }
  private check(generation: number): void {
    if (generation !== this.generation)
      throw new GitHubError(
        "GitHub connection changed. Refresh before retrying.",
      );
  }
  private hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
  private async checkConnection(
    generation: number,
    token: string,
  ): Promise<void> {
    this.check(generation);
    if ((await this.secrets.get(githubSecretKey)) !== token) {
      this.clear();
      throw new GitHubError(
        "GitHub connection changed. Refresh before retrying.",
      );
    }
    this.check(generation);
  }
  public async connect(token: string): Promise<void> {
    if (!token || token.length > 1024 || /\s/u.test(token))
      throw new GitHubError("Enter a valid GitHub PAT without whitespace.");
    const generation = ++this.generation;
    const profile = record(await this.json("/user", token));
    if (!githubOwner(profile.login))
      throw new GitHubError("GitHub returned an invalid account.");
    this.check(generation);
    await this.secrets.store(githubSecretKey, token);
    this.clear();
  }
  public async disconnect(): Promise<void> {
    this.clear();
    await this.secrets.delete(githubSecretKey);
  }
  public async refresh(): Promise<GitHubState> {
    this.clear();
    const generation = this.generation,
      token = await this.token();
    const profile = record(await this.json("/user", token));
    if (!githubOwner(profile.login))
      throw new GitHubError("GitHub returned an invalid account.");
    const orgs = new Set<string>();
    let notice = "";
    try {
      for (let page = 1; page <= 10; page++) {
        const list = await this.json(
          "/user/orgs?per_page=100&page=" + page,
          token,
        );
        if (!Array.isArray(list) || list.length > 100)
          throw new GitHubError("GitHub returned invalid organizations.");
        list.forEach((raw: unknown) => {
          const item = record(raw);
          if (githubOwner(item?.login)) orgs.add(item.login);
        });
        if (list.length < 100) break;
        if (page === 10) notice = "Showing up to 1,000 organizations.";
      }
    } catch (error) {
      // Fine-grained tokens may not expose membership. Discover their visible owners instead.
      if (!(error instanceof GitHubError) || error.status !== 403) throw error;
      notice =
        "Organization membership is limited by this token; showing organizations found in accessible repositories.";
    }
    if (!orgs.size || notice.startsWith("Organization membership is limited")) {
      for (let page = 1; page <= 50; page++) {
        const list = await this.json(
          "/user/repos?per_page=100&page=" + page,
          token,
        );
        if (!Array.isArray(list) || list.length > 100)
          throw new GitHubError("GitHub returned invalid repositories.");
        list.forEach((raw: unknown) => {
          const item = record(raw),
            owner = record(item.owner);
          if (owner.type === "Organization" && githubOwner(owner.login))
            orgs.add(owner.login);
        });
        if (list.length < 100) break;
        if (page === 50)
          notice += " Discovery is limited to 5,000 accessible repositories.";
      }
    }
    await this.checkConnection(generation, token);
    this.credentialHash = this.hash(token);
    this.login = profile.login;
    this.organizations = [...orgs].sort();
    this.notice = notice;
    return this.state();
  }
  public async browse(owner: string, more = false): Promise<GitHubState> {
    await this.state();
    if (
      !githubOwner(owner) ||
      ![this.login, ...this.organizations].includes(owner)
    )
      throw new GitHubError("Select an organization loaded from GitHub first.");
    const generation = this.generation,
      token = await this.token();
    if (more && (owner !== this.owner || !this.nextPage))
      throw new GitHubError("Refresh this repository list first.");
    const page = more ? this.nextPage : 1;
    const path =
      owner === this.login
        ? "/user/repos?affiliation=owner,collaborator&"
        : "/orgs/" + encodeURIComponent(owner) + "/repos?type=all&";
    const list = await this.json(
      path + "per_page=100&sort=updated&page=" + page,
      token,
    );
    if (!Array.isArray(list) || list.length > 100)
      throw new GitHubError("GitHub returned invalid repositories.");
    const repositories: GitHubRepository[] = [];
    for (const raw of list as unknown[]) {
      const item = record(raw),
        ownerRecord = record(item.owner);
      if (
        !githubRepositoryId(String(item?.id)) ||
        !githubOwner(ownerRecord.login) ||
        typeof item?.name !== "string" ||
        !/^[a-z0-9_.-]{1,100}$/iu.test(item.name) ||
        [".", "..", ".git"].includes(item.name.toLowerCase()) ||
        typeof item.private !== "boolean"
      )
        throw new GitHubError("GitHub returned invalid repository metadata.");
      if (
        owner !== this.login &&
        ownerRecord.login.toLowerCase() !== owner.toLowerCase()
      )
        throw new GitHubError(
          "GitHub returned a repository outside the selected organization.",
        );
      repositories.push({
        id: String(item.id),
        owner: ownerRecord.login,
        name: item.name,
        description:
          typeof item.description === "string"
            ? item.description.slice(0, 500)
            : "",
        private: item.private,
        archived: item.archived === true,
      });
    }
    await this.checkConnection(generation, token);
    this.owner = owner;
    this.repositories = [
      ...new Map(
        [...(more ? this.repositories : []), ...repositories].map((repo) => [
          repo.id,
          repo,
        ]),
      ).values(),
    ];
    this.nextPage = list.length === 100 && page < 50 ? page + 1 : 0;
    this.loadedAt = Date.now();
    return this.state(
      page === 50 && list.length === 100
        ? "Repository limit reached (5,000). Narrow token access."
        : this.notice,
    );
  }
  public async repository(id: string): Promise<GitHubRepository> {
    await this.state();
    await this.token();
    const repo = this.repositories.find((repo) => repo.id === id);
    if (!repo || Date.now() - this.loadedAt > 10 * 60_000)
      throw new GitHubError(
        "Repository selection expired. Refresh the list before cloning.",
      );
    return repo;
  }
}
