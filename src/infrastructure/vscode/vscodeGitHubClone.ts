import * as vscode from "vscode";
import {
  githubSecretKey,
  GitHubError,
} from "../../application/services/githubService";
import type { GitHubRepository } from "../../domain/github";

interface GitApi {
  clone?: (
    uri: vscode.Uri,
    options: {
      parentPath: vscode.Uri;
      recursive: boolean;
      postCloneAction: "none";
    },
  ) => Promise<vscode.Uri | null>;
  registerCredentialsProvider(provider: {
    getCredentials(
      host: vscode.Uri,
    ): Promise<{ username: string; password: string } | undefined>;
  }): vscode.Disposable;
}
export class VscodeGitHubClone {
  private busy = false;
  public constructor(private readonly secrets: vscode.SecretStorage) {}
  public async clone(repo: GitHubRepository): Promise<string | undefined> {
    if (this.busy) throw new GitHubError("A GitHub clone is already running.");
    if (!vscode.workspace.isTrusted)
      throw new GitHubError(
        "Trust this VS Code workspace before cloning a repository.",
      );
    this.busy = true;
    try {
      const extension = vscode.extensions.getExtension<{
        enabled: boolean;
        getAPI(version: 1): GitApi;
      }>("vscode.git");
      if (!extension)
        throw new GitHubError(
          "Enable VS Code's built-in Git extension and install Git first.",
        );
      const exports = await extension.activate();
      if (!exports.enabled)
        throw new GitHubError("Enable VS Code's built-in Git extension first.");
      const api = exports.getAPI(1);
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Clone into this folder",
      });
      const parent = selected?.[0];
      if (!parent) return undefined;
      if (
        parent.scheme !== "file" ||
        !vscode.workspace.isTrusted ||
        (await vscode.workspace.fs.stat(parent)).type !==
          vscode.FileType.Directory
      )
        throw new GitHubError(
          "Select an existing local folder in a trusted workspace.",
        );
      const target = vscode.Uri.joinPath(parent, repo.name);
      try {
        await vscode.workspace.fs.stat(target);
        throw new GitHubError(
          "A folder with this repository name already exists. Choose another destination; existing files are never replaced.",
        );
      } catch (error) {
        if (
          !(error instanceof vscode.FileSystemError) ||
          error.code !== "FileNotFound"
        )
          throw error;
      }
      const confirmation = await vscode.window.showWarningMessage(
        "Clone " +
          repo.owner +
          "/" +
          repo.name +
          " into " +
          parent.fsPath +
          " and add it to Project launcher? Git uses your native VS Code credentials or this GitHub PAT. No submodules are cloned." +
          (api.clone
            ? ""
            : " If VS Code asks to open the clone, dismiss that prompt to remain in the dashboard."),
        { modal: true },
        "Clone and add",
      );
      if (confirmation !== "Clone and add") return undefined;
      if (!vscode.workspace.isTrusted)
        throw new GitHubError("Workspace trust changed. Clone cancelled.");
      const url = "https://github.com/" + repo.owner + "/" + repo.name + ".git";
      const approvedToken = await this.secrets.get(githubSecretKey);
      if (!approvedToken)
        throw new GitHubError(
          "GitHub was disconnected. Reconnect before cloning.",
        );
      let active = true;
      const credentials = api.registerCredentialsProvider({
        getCredentials: async (host) => {
          const uri = new URL(host.toString());
          if (
            !active ||
            uri.protocol !== "https:" ||
            uri.hostname !== "github.com" ||
            uri.port ||
            uri.username ||
            uri.password ||
            (uri.pathname !== "/" && uri.pathname !== new URL(url).pathname)
          )
            return undefined;
          const token = await this.secrets.get(githubSecretKey);
          return active && token && token === approvedToken
            ? { username: "x-access-token", password: token }
            : undefined;
        },
      });
      try {
        if (api.clone) {
          const result = await api.clone(vscode.Uri.parse(url), {
            parentPath: parent,
            recursive: false,
            postCloneAction: "none",
          });
          if (!result) return undefined;
          if (result.toString() !== target.toString())
            throw new GitHubError(
              "Git returned a different destination. The clone was not added; check the selected folder.",
            );
        } else {
          await vscode.commands.executeCommand("git.clone", url, parent.fsPath);
        }
      } finally {
        active = false;
        credentials.dispose();
      }
      // Native clone failures/cancellations must not create a phantom project.
      if (
        (await vscode.workspace.fs.stat(vscode.Uri.joinPath(target, ".git")))
          .type !== vscode.FileType.Directory
      )
        throw new GitHubError(
          "Clone did not complete. Existing files were not removed; check Git's Output channel before retrying.",
        );
      return target.fsPath;
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      throw new GitHubError(
        "GitHub clone failed or was cancelled. Check Git's Output channel, Git credential helper, proxy and repository permissions. No automatic retry or cleanup was attempted.",
      );
    } finally {
      this.busy = false;
    }
  }
}
