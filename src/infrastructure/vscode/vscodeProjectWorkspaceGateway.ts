import * as vscode from "vscode";
import { randomUUID } from "node:crypto";

import type { OperatingSystem } from "../../platform/platformService";
import { NodeDeveloperApplicationProcessGateway } from "../../platform/developerApplicationProcess";

export interface ConfiguredIde {
  readonly id: string;
  readonly name: string;
}

interface StoredIde extends ConfiguredIde {
  readonly executablePath: string;
}

interface ExternalIdeGateway {
  inspect(executablePath: string): Promise<{ readonly name: string }>;
  openPath(executablePath: string, targetPath: string): Promise<void>;
}

const storageKey = "workspace.configuredIdes";
const vscodeIde: ConfiguredIde = { id: "vscode", name: "Visual Studio Code" };

export class VscodeProjectWorkspaceGateway {
  private readonly externalIde: ExternalIdeGateway;

  public constructor(
    private readonly globalState: vscode.Memento,
    operatingSystem: OperatingSystem,
    externalIde?: ExternalIdeGateway,
  ) {
    this.externalIde =
      externalIde ??
      new NodeDeveloperApplicationProcessGateway(operatingSystem);
  }

  public ides(): readonly ConfiguredIde[] {
    return [
      vscodeIde,
      ...this.readStoredIdes().map(({ id, name }) => ({ id, name })),
    ];
  }

  public async configure(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: process.platform === "darwin",
      canSelectMany: false,
      openLabel: "Add IDE",
      title: "Select an IDE application or executable",
    });
    if (!selected?.[0]) return;
    const executablePath = selected[0].fsPath;
    const inspected = await this.externalIde.inspect(executablePath);
    const current = this.readStoredIdes();
    if (current.some((item) => item.executablePath === executablePath))
      throw new Error("This IDE is already configured.");
    await this.globalState.update(storageKey, [
      ...current,
      { id: randomUUID(), name: inspected.name, executablePath },
    ] satisfies readonly StoredIde[]);
  }

  public async remove(id: string): Promise<void> {
    if (id === vscodeIde.id) return;
    await this.globalState.update(
      storageKey,
      this.readStoredIdes().filter((item) => item.id !== id),
    );
  }

  public async openProject(localPath: string): Promise<void> {
    const configured = this.readStoredIdes();
    const selected = await vscode.window.showQuickPick(
      [vscodeIde, ...configured].map((item) => ({
        label: item.name,
        description: item.id === "vscode" ? "VS Code" : "Configured IDE",
        id: item.id,
      })),
      {
        title: "Open project",
        placeHolder:
          configured.length > 0
            ? "Choose an IDE"
            : "Add other IDEs in DevDashboardV1 Settings",
      },
    );
    if (!selected) return;
    const external = configured.find((item) => item.id === selected.id);
    if (external) {
      await this.externalIde.openPath(external.executablePath, localPath);
      return;
    }
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(localPath),
      { forceNewWindow: true },
    );
  }

  private readStoredIdes(): readonly StoredIde[] {
    const stored = this.globalState.get<unknown>(storageKey, []);
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (item): item is StoredIde =>
        !!item &&
        typeof item === "object" &&
        typeof (item as StoredIde).id === "string" &&
        /^[0-9a-f-]{36}$/iu.test((item as StoredIde).id) &&
        typeof (item as StoredIde).name === "string" &&
        (item as StoredIde).name.length <= 100 &&
        typeof (item as StoredIde).executablePath === "string" &&
        (item as StoredIde).executablePath.length <= 4096,
    );
  }
}
