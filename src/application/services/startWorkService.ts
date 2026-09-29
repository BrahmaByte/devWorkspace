import type { WorkspaceRepository } from "../../infrastructure/database/workspaceRepository";

export interface GitWorkflow {
  isRepository(cwd: string): Promise<boolean>;
  branchExists(cwd: string, branchName: string): Promise<boolean>;
  switchBranch(cwd: string, branchName: string, create: boolean): Promise<void>;
}

export interface ProjectWorkspaceGateway {
  openProject(localPath: string): Promise<void>;
  openTerminal(localPath: string): Promise<void>;
}

export interface BranchConfirmationGateway {
  confirmBranchChange(
    issueKey: string,
    branchName: string,
    create: boolean,
  ): Promise<boolean>;
}

export interface StartWorkResult {
  readonly projectId: string;
  readonly projectName: string;
  readonly branchName?: string;
  readonly branchChanged: boolean;
  readonly started: boolean;
}

export class StartWorkService {
  public constructor(
    private readonly projects: WorkspaceRepository,
    private readonly git: GitWorkflow,
    private readonly workspace: ProjectWorkspaceGateway,
    private readonly confirmations: BranchConfirmationGateway,
  ) {}

  public async start(
    issueKey: string,
    branchName?: string,
  ): Promise<StartWorkResult> {
    const jiraProjectKey = issueProjectKey(issueKey);
    const project = this.projects.getProjectByJiraKey(jiraProjectKey);
    if (!project)
      throw new Error("No local project is associated with this Jira project.");
    if (!(await this.git.isRepository(project.localPath)))
      throw new Error("The associated project is not a Git repository.");

    let branchChanged = false;
    const normalizedBranch = branchName?.trim();
    if (normalizedBranch) {
      validateBranchName(normalizedBranch);
      const exists = await this.git.branchExists(
        project.localPath,
        normalizedBranch,
      );
      if (
        !(await this.confirmations.confirmBranchChange(
          issueKey,
          normalizedBranch,
          !exists,
        ))
      )
        return {
          projectId: project.id,
          projectName: project.name,
          branchChanged: false,
          started: false,
        };
      await this.git.switchBranch(project.localPath, normalizedBranch, !exists);
      branchChanged = true;
    }

    await this.workspace.openTerminal(project.localPath);
    await this.workspace.openProject(project.localPath);
    return {
      projectId: project.id,
      projectName: project.name,
      ...(normalizedBranch ? { branchName: normalizedBranch } : {}),
      branchChanged,
      started: true,
    };
  }
}

export function issueProjectKey(issueKey: string): string {
  const match = /^([A-Z][A-Z0-9_]{0,19})-[1-9][0-9]{0,9}$/u.exec(issueKey);
  if (!match?.[1]) throw new Error("Issue key is invalid.");
  return match[1];
}

export function validateBranchName(value: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/u.test(value) ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("@{") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.endsWith(".lock")
  )
    throw new Error("Branch name is invalid.");
}
