export interface GitHubRepository {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly description: string;
  readonly private: boolean;
  readonly archived: boolean;
}
export interface GitHubState {
  readonly connected: boolean;
  readonly login: string;
  readonly organizations: readonly string[];
  readonly owner: string;
  readonly repositories: readonly GitHubRepository[];
  readonly hasMore: boolean;
  readonly message: string;
}
export const githubOwner = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,38}$/iu.test(value);
export const githubRepositoryId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,19}$/u.test(value);
