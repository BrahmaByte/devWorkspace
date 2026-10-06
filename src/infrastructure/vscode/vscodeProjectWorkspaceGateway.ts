import * as vscode from "vscode";

export class VscodeProjectWorkspaceGateway {
  public async openProject(localPath: string): Promise<void> {
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(localPath),
      { forceNewWindow: true },
    );
  }
}
