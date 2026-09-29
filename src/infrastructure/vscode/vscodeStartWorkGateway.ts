import * as vscode from "vscode";

import type {
  BranchConfirmationGateway,
  ProjectWorkspaceGateway,
} from "../../application/services/startWorkService";

export class VscodeProjectWorkspaceGateway implements ProjectWorkspaceGateway {
  public openTerminal(localPath: string): Promise<void> {
    vscode.window
      .createTerminal({ name: "DevWorkspace", cwd: localPath })
      .show();
    return Promise.resolve();
  }

  public async openProject(localPath: string): Promise<void> {
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(localPath),
      { forceNewWindow: true },
    );
  }
}

export class VscodeBranchConfirmationGateway implements BranchConfirmationGateway {
  public async confirmBranchChange(
    issueKey: string,
    branchName: string,
    create: boolean,
  ): Promise<boolean> {
    const action = create ? "Create and switch" : "Switch";
    return (
      (await vscode.window.showWarningMessage(
        `${action} Git branch “${branchName}” for ${issueKey}?`,
        { modal: true },
        action,
      )) === action
    );
  }
}
