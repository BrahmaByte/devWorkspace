import type { OperatingSystem } from "../../platform/platformService";

export const confirmationPolicies = ["always", "dangerous", "never"] as const;
export type ConfirmationPolicy = (typeof confirmationPolicies)[number];

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly localPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly gitBranch?: string;
}

export interface ProjectCommand {
  readonly id: string;
  readonly projectId?: string;
  readonly name: string;
  readonly command: string;
  readonly platform: OperatingSystem | "any";
  readonly shell: string;
  readonly workingDirectory?: string;
  readonly confirmationPolicy: ConfirmationPolicy;
}

export interface EnvironmentProfile {
  readonly id: string;
  readonly projectId?: string;
  readonly name: string;
  readonly description: string;
  readonly variableNames: readonly string[];
}

export interface WorkspaceState {
  readonly projects: readonly Project[];
  readonly commands: readonly ProjectCommand[];
  readonly environmentProfiles: readonly EnvironmentProfile[];
}
