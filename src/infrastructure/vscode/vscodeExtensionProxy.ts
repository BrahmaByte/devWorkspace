import * as vscode from "vscode";
import {
  validateProxyUrl,
  validateProxyCa,
  type ExtensionProxyConfig,
} from "../http/extensionProxy";

const KEY = "network.customProxy";

export class VscodeExtensionProxy {
  public constructor(private readonly secrets: vscode.SecretStorage) {}
  public async load(): Promise<ExtensionProxyConfig | undefined> {
    const value = await this.secrets.get(KEY);
    const config = value
      ? (JSON.parse(value) as ExtensionProxyConfig & { enabled?: boolean })
      : undefined;
    // Legacy overrides remain saved, but native networking is now the default.
    return config?.enabled === true ? config : undefined;
  }
  public async configure(): Promise<void> {
    const previous = await this.load();
    const mode = await vscode.window.showQuickPick(
      [
        {
          label: "Use VS Code proxy (default)",
          description: "Recommended for corporate networks on Mac and Windows",
          detail:
            "Use VS Code's native proxy discovery, PAC/bypass rules and supported authentication negotiation. No extension-only credentials are required.",
        },
        {
          label: "Configure extension-only proxy",
          description: "Fixed HTTP/HTTPS proxy: Basic or no authentication",
          detail:
            "Does not negotiate NTLM, Kerberos, Digest or corporate SSO. Use VS Code-managed mode for those environments.",
        },
      ],
      {
        title:
          "DevDashboardV1 proxy: " +
          (previous ? "extension-only" : "VS Code default"),
      },
    );
    if (!mode) return;
    if (mode.label.startsWith("Use")) {
      await this.secrets.delete(KEY);
      const action = await vscode.window.showInformationMessage(
        "DevDashboardV1 now delegates proxy discovery and authentication negotiation to VS Code. Available authentication depends on your VS Code version, OS and corporate policy. No global settings were changed.",
        "Open VS Code proxy settings",
      );
      if (action)
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "http.proxy",
        );
      return;
    }
    const url = await vscode.window.showInputBox({
      title: "Extension-only proxy URL",
      prompt:
        "HTTP or HTTPS proxy. HTTPS also encrypts proxy credentials. Applies only to Jira and Confluence; no direct fallback.",
      value: previous?.url,
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          validateProxyUrl(value);
          return undefined;
        } catch {
          return "Use http://host:port or https://host:port without embedded credentials.";
        }
      },
    });
    if (url === undefined) return;
    const username = await vscode.window.showInputBox({
      title: "Proxy username (optional)",
      prompt:
        "Enter your IT-provided proxy username for Basic authentication, not your Jira or Confluence credentials. Leave empty if authentication is not required.",
      ignoreFocusOut: true,
      validateInput: (value) =>
        /[:\r\n\0]/u.test(value)
          ? "Username cannot contain colon or control characters."
          : undefined,
    });
    if (username === undefined) return;
    const password = username
      ? await vscode.window.showInputBox({
          title: "Proxy password",
          prompt:
            "Enter the password for your proxy account. Input is hidden; proxy credentials are saved securely in VS Code SecretStorage.",
          password: true,
          ignoreFocusOut: true,
        })
      : undefined;
    if (username && password === undefined) return;
    const certificate = await vscode.window.showQuickPick(
      ["Use default trusted certificates", "Select corporate CA bundle (PEM)"],
      { title: "Proxy and server TLS trust (verification always enabled)" },
    );
    if (!certificate) return;
    let ca: string | undefined;
    if (certificate.startsWith("Select")) {
      const files = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFolders: false,
        filters: { "PEM certificates": ["pem", "crt", "cer"] },
        title: "Select your IT-approved corporate CA bundle",
      });
      if (!files?.[0]) return;
      if ((await vscode.workspace.fs.stat(files[0])).size > 1_000_000)
        throw new Error("CA bundle is too large.");
      ca = Buffer.from(await vscode.workspace.fs.readFile(files[0])).toString(
        "utf8",
      );
      validateProxyCa(ca);
    }
    await this.secrets.store(
      KEY,
      JSON.stringify({
        enabled: true,
        url: validateProxyUrl(url),
        ...(username ? { username, password } : {}),
        ...(ca ? { ca } : {}),
      }),
    );
    await vscode.window.showInformationMessage(
      "Extension-only proxy saved. Sync Jira or refresh Confluence to retry; no reload needed.",
    );
  }
}
