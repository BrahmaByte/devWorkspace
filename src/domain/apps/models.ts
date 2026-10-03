export type DeveloperApplicationStatus = "running" | "stopped";

export interface DeveloperApplication {
  readonly id: string;
  readonly name: string;
  readonly executablePath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastLaunchedAt?: string;
}

export interface DeveloperApplicationSummary {
  readonly id: string;
  readonly name: string;
  readonly iconDataUrl?: string;
  readonly status: DeveloperApplicationStatus;
  readonly lastLaunchedAt?: string;
}
