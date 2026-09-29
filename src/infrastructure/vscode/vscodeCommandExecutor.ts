import * as vscode from "vscode";

import type {
  CommandExecutor,
  ConfirmationGateway,
} from "../../application/services/commandExecutionService";

export class VscodeCommandExecutor implements CommandExecutor {
  public execute(shell: string, command: string, cwd?: string): Promise<void> {
    const terminal = vscode.window.createTerminal({
      name: "DevWorkspace command",
      cwd,
      shellPath: shell,
    });
    terminal.show();
    terminal.sendText(command, true);
    return Promise.resolve();
  }
  public openTerminal(cwd: string, shell: string): Promise<void> {
    vscode.window
      .createTerminal({ name: "DevWorkspace", cwd, shellPath: shell })
      .show();
    return Promise.resolve();
  }
}

export class VscodeConfirmationGateway implements ConfirmationGateway {
  public async confirm(label: string): Promise<boolean> {
    return (
      (await vscode.window.showWarningMessage(
        `Run configured command “${label}”?`,
        { modal: true },
        "Run",
      )) === "Run"
    );
  }
}
