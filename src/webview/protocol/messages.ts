export const shellPages = [
  "home",
  "jira",
  "workspace",
  "notes",
  "knowledge",
] as const;

export type ShellPage = (typeof shellPages)[number];

export type WebviewRequest =
  | { readonly type: "shell.ready" }
  | { readonly type: "navigation.select"; readonly page: ShellPage };

export type ExtensionResponse =
  | {
      readonly type: "shell.state";
      readonly page: ShellPage;
      readonly platform: "windows" | "macos" | "linux";
    }
  | {
      readonly type: "protocol.error";
      readonly code: "invalid_message";
      readonly message: string;
    };
