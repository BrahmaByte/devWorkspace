import { posix, win32 } from "node:path";

import { isDangerousCommand } from "./workspaceService";
import type { WorkspaceRepository } from "../../infrastructure/database/workspaceRepository";
import type { OperatingSystem } from "../../platform/platformService";

export interface CommandExecutor {
  execute(shell: string, command: string, cwd: string): Promise<void>;
  openTerminal(cwd: string, shell: string): Promise<void>;
}
export interface ConfirmationGateway {
  confirm(label: string): Promise<boolean>;
}

export class CommandExecutionService {
  public constructor(
    private readonly repository: WorkspaceRepository,
    private readonly executor: CommandExecutor,
    private readonly confirmations: ConfirmationGateway,
    private readonly operatingSystem: OperatingSystem,
  ) {}
  public async execute(commandId: string): Promise<void> {
    const command = this.repository.getCommand(commandId);
    if (!command) throw new Error("Command not found.");
    if (command.platform !== "any" && command.platform !== this.operatingSystem)
      throw new Error("Command is not available on this platform.");
    const project = this.repository.getProject(command.projectId);
    if (!project) throw new Error("Project not found.");
    const pathApi = this.operatingSystem === "windows" ? win32 : posix;
    const cwd = command.workingDirectory
      ? pathApi.resolve(project.localPath, command.workingDirectory)
      : project.localPath;
    if (
      !pathApi.isAbsolute(cwd) ||
      (cwd !== project.localPath &&
        !cwd.startsWith(project.localPath + pathApi.sep))
    )
      throw new Error("Working directory escapes the project.");
    const mustConfirm =
      command.confirmationPolicy === "always" ||
      (command.confirmationPolicy === "dangerous" &&
        isDangerousCommand(command.command));
    if (mustConfirm && !(await this.confirmations.confirm(command.name)))
      return;
    await this.executor.execute(command.shell, command.command, cwd);
  }
  public async openProjectTerminal(
    projectId: string,
    shell: string,
  ): Promise<void> {
    const project = this.repository.getProject(projectId);
    if (!project) throw new Error("Project not found.");
    await this.executor.openTerminal(project.localPath, shell);
  }
}
