import { randomUUID } from "node:crypto";

import type {
  DeveloperApplication,
  DeveloperApplicationSummary,
} from "../../domain/apps/models";
import type { DeveloperApplicationRepository } from "../../infrastructure/database/developerApplicationRepository";

export interface ManagedApplicationProcess {
  readonly exited: Promise<void>;
  readonly canClose?: boolean;
  dispose?(): void;
  close(): Promise<void>;
}

export interface DeveloperApplicationProcessGateway {
  inspect(executablePath: string): Promise<{ readonly name: string }>;
  launch(executablePath: string): Promise<ManagedApplicationProcess>;
}

export type DeveloperApplicationChangeListener = () => void;

export class DeveloperApplicationService {
  private readonly running = new Map<string, ManagedApplicationProcess>();
  private readonly changeListeners =
    new Set<DeveloperApplicationChangeListener>();

  public constructor(
    private readonly repository: DeveloperApplicationRepository,
    private readonly processGateway: DeveloperApplicationProcessGateway,
  ) {}

  public onDidChange(listener: DeveloperApplicationChangeListener): {
    dispose(): void;
  } {
    this.changeListeners.add(listener);
    return { dispose: () => this.changeListeners.delete(listener) };
  }

  public list(): readonly DeveloperApplicationSummary[] {
    return this.repository.list().map((application) => ({
      id: application.id,
      name: application.name,
      status: this.running.has(application.id) ? "running" : "stopped",
      canClose:
        this.running.has(application.id) &&
        this.running.get(application.id)?.canClose !== false,
      lastLaunchedAt: application.lastLaunchedAt,
    }));
  }

  public getIconSource(id: string): string {
    return this.getApplication(id).executablePath;
  }

  public async add(executablePath: string): Promise<string> {
    const inspected = await this.processGateway.inspect(executablePath);
    const normalizedPath = executablePath.trim();
    if (
      this.repository
        .list()
        .some((application) => application.executablePath === normalizedPath)
    )
      throw new Error("This application is already on the dashboard.");
    const now = new Date().toISOString();
    const application: DeveloperApplication = {
      id: randomUUID(),
      name: inspected.name,
      executablePath: normalizedPath,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.save(application);
    this.emitChange();
    return application.id;
  }

  public async launch(id: string): Promise<void> {
    if (this.running.has(id)) return;
    const application = this.getApplication(id);
    const process = await this.processGateway.launch(
      application.executablePath,
    );
    this.running.set(id, process);
    const now = new Date().toISOString();
    await this.repository.save({
      ...application,
      lastLaunchedAt: now,
      updatedAt: now,
    });
    this.emitChange();
    void process.exited.finally(() => {
      if (this.running.get(id) !== process) return;
      this.running.delete(id);
      this.emitChange();
    });
  }

  public async close(id: string): Promise<void> {
    const process = this.running.get(id);
    if (!process) throw new Error("This application is not running.");
    await process.close();
  }

  public async delete(id: string): Promise<void> {
    if (this.running.has(id))
      throw new Error("Close the application before removing it.");
    this.getApplication(id);
    await this.repository.delete(id);
    this.emitChange();
  }

  public dispose(): void {
    this.changeListeners.clear();
    for (const process of this.running.values()) process.dispose?.();
    this.running.clear();
  }

  private getApplication(id: string): DeveloperApplication {
    const application = this.repository.get(id);
    if (!application) throw new Error("Developer application was not found.");
    return application;
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) listener();
  }
}
