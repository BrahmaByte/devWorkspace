import { randomUUID } from "node:crypto";
import { isAbsolute, normalize, win32 } from "node:path";

import {
  confirmationPolicies,
  preferredIdes,
  type ConfirmationPolicy,
  type PreferredIde,
} from "../../domain/workspace/models";
import type { WorkspaceRepository } from "../../infrastructure/database/workspaceRepository";
import type { OperatingSystem } from "../../platform/platformService";

export const workspaceLimits = {
  name: 100,
  path: 2_000,
  command: 2_000,
  description: 500,
  variableName: 100,
} as const;

export class WorkspaceService {
  public constructor(
    private readonly repository: WorkspaceRepository,
    private readonly operatingSystem: OperatingSystem,
  ) {}
  public getState() {
    return this.repository.getState();
  }

  public async createProject(
    name: string,
    localPath: string,
    preferredIde?: PreferredIde,
  ): Promise<string> {
    this.validateProject(name, localPath, preferredIde);
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.repository.createProject({
      id,
      name: name.trim(),
      localPath,
      preferredIde,
      isFavourite: false,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }
  public updateProject(
    id: string,
    name: string,
    localPath: string,
    preferredIde?: PreferredIde,
  ) {
    this.requireId(id);
    this.validateProject(name, localPath, preferredIde);
    return this.repository.updateProject(
      id,
      name.trim(),
      localPath,
      preferredIde,
      new Date().toISOString(),
    );
  }
  public setFavourite(id: string, favourite: boolean) {
    this.requireId(id);
    return this.repository.setFavourite(
      id,
      favourite,
      new Date().toISOString(),
    );
  }
  public deleteProject(id: string) {
    this.requireId(id);
    return this.repository.deleteProject(id);
  }

  public async createCommand(
    projectId: string,
    name: string,
    command: string,
    platform: OperatingSystem | "any",
    shell: string,
    workingDirectory: string | undefined,
    policy: ConfirmationPolicy,
  ): Promise<string> {
    this.requireId(projectId);
    this.requireText(name, workspaceLimits.name);
    this.validateCommand(command);
    if (!["any", "windows", "macos", "linux"].includes(platform))
      throw new Error("Invalid platform.");
    if (!confirmationPolicies.includes(policy))
      throw new Error("Invalid confirmation policy.");
    if (workingDirectory) this.validateWorkingDirectory(workingDirectory);
    if (policy === "never" && isDangerousCommand(command))
      throw new Error("Dangerous commands cannot bypass confirmation.");
    const id = randomUUID();
    await this.repository.createCommand({
      id,
      projectId,
      name: name.trim(),
      command,
      platform,
      shell: shell.trim(),
      workingDirectory,
      confirmationPolicy: policy,
    });
    return id;
  }
  public deleteCommand(id: string) {
    this.requireId(id);
    return this.repository.deleteCommand(id);
  }

  public async createEnvironment(
    projectId: string | undefined,
    name: string,
    description: string,
    variableNames: readonly string[],
  ): Promise<string> {
    if (projectId) this.requireId(projectId);
    this.requireText(name, workspaceLimits.name);
    if (description.length > workspaceLimits.description)
      throw new Error("Description is too long.");
    if (
      variableNames.length > 100 ||
      variableNames.some((item) => !/^[A-Z_][A-Z0-9_]{0,99}$/u.test(item))
    )
      throw new Error("Environment variable names are invalid.");
    const id = randomUUID();
    await this.repository.createEnvironment({
      id,
      projectId,
      name: name.trim(),
      description,
      variableNames: [...new Set(variableNames)],
    });
    return id;
  }
  public deleteEnvironment(id: string) {
    this.requireId(id);
    return this.repository.deleteEnvironment(id);
  }

  private validateProject(
    name: string,
    localPath: string,
    preferredIde?: PreferredIde,
  ): void {
    this.requireText(name, workspaceLimits.name);
    this.validatePath(localPath);
    if (preferredIde && !preferredIdes.includes(preferredIde))
      throw new Error("Invalid IDE.");
  }
  private validatePath(value: string): void {
    const absolute =
      this.operatingSystem === "windows"
        ? win32.isAbsolute(value)
        : isAbsolute(value);
    if (
      value.length === 0 ||
      value.length > workspaceLimits.path ||
      value.includes("\0") ||
      !absolute
    )
      throw new Error("Path must be absolute.");
    const normalized =
      this.operatingSystem === "windows"
        ? win32.normalize(value)
        : normalize(value);
    const comparable = value.length > 1 ? value.replace(/[\\/]$/u, "") : value;
    if (normalized !== comparable) throw new Error("Path must be normalized.");
  }
  private validateWorkingDirectory(value: string): void {
    const pathApi =
      this.operatingSystem === "windows" ? win32 : { isAbsolute, normalize };
    if (
      value.length > workspaceLimits.path ||
      value.includes("\0") ||
      pathApi.isAbsolute(value)
    )
      throw new Error("Working directory must be relative.");
    const normalized = pathApi.normalize(value);
    if (
      normalized !== value ||
      normalized === ".." ||
      normalized.startsWith(
        `..${this.operatingSystem === "windows" ? "\\" : "/"}`,
      )
    )
      throw new Error("Working directory must stay inside the project.");
  }
  private validateCommand(value: string): void {
    if (
      value.trim().length === 0 ||
      value.length > workspaceLimits.command ||
      /[\r\n\0]/u.test(value)
    )
      throw new Error("Command is invalid.");
  }
  private requireText(value: string, maximum: number): void {
    if (value.trim().length === 0 || value.length > maximum)
      throw new Error("Value is invalid.");
  }
  private requireId(value: string): void {
    if (!/^[0-9a-f-]{36}$/iu.test(value))
      throw new Error("Invalid identifier.");
  }
}

export function isDangerousCommand(command: string): boolean {
  return /(?:^|\s)(?:rm\s+-rf|rmdir\s+\/s|del\s+\/f|format\s+[a-z]:|git\s+reset\s+--hard|sudo\b|shutdown\b)/iu.test(
    command,
  );
}
