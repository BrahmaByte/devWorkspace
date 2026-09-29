export interface GitRunner {
  branch(cwd: string): Promise<string | undefined>;
}

export class GitBranchService {
  public constructor(private readonly runner: GitRunner) {}

  public async getBranch(projectPath: string): Promise<string | undefined> {
    try {
      const branch = (await this.runner.branch(projectPath))?.trim();
      return branch && branch.length <= 255 ? branch : undefined;
    } catch {
      return undefined;
    }
  }
}
