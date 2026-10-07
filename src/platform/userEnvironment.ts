import { execFile } from "node:child_process";
import { lstat, readFile, open, rename, unlink } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { basename, join, win32 } from "node:path";
import { randomUUID } from "node:crypto";
import type { OperatingSystem } from "./platformService";

export class UserEnvironmentError extends Error {}
export type EnvironmentWriteMode = "overwrite" | "append";
export const environmentNamePattern = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/u;
const maximumValue = 16_000;
const blocked =
  /^(?:HOME|USER|USERNAME|LOGNAME|SHELL|COMSPEC|SYSTEMROOT|WINDIR|APPDATA|LOCALAPPDATA|USERPROFILE|ZDOTDIR|ENV|BASH_ENV|SHELLOPTS|BASHOPTS|PROMPT_COMMAND|NODE_OPTIONS|NODE_PATH|NODE_TLS_REJECT_UNAUTHORIZED|PSExecutionPolicyPreference|PYTHONSTARTUP|PYTHONINSPECT|RUBYOPT|PERL5OPT|GIT_SSH_COMMAND|GIT_ASKPASS|SSH_ASKPASS|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS|DOTNET_STARTUP_HOOKS|ELECTRON_.*|VSCODE_.*|CODEX_HOME|LD_.*|DYLD_.*)$/iu;
const sensitive =
  /(?:TOKEN|PASSWORD|PASSWD|SECRET|CREDENTIAL|PRIVATE_KEY|API_KEY|ACCESS_KEY|AUTHORIZATION)/iu;

export function validateEnvironmentName(name: string): void {
  if (
    !environmentNamePattern.test(name) ||
    blocked.test(name) ||
    sensitive.test(name)
  )
    throw new UserEnvironmentError(
      "Use a non-secret variable name. Credentials and startup/security hooks cannot be edited here.",
    );
}
function validateValue(value: string): void {
  if (
    !value.length ||
    value.length > maximumValue ||
    /[\r\n\0]/u.test(value) ||
    /-----BEGIN .*PRIVATE KEY|\bBearer\s+|\bgh[pousr]_[A-Za-z0-9]+|https?:\/\/[^\s/]+:[^\s/]+@/iu.test(
      value,
    )
  )
    throw new UserEnvironmentError(
      "Enter a non-empty, single-line, non-secret value of at most 16000 characters.",
    );
}
export function environmentValue(
  name: string,
  current: string,
  addition: string,
  mode: EnvironmentWriteMode,
  os: OperatingSystem,
): string {
  validateEnvironmentName(name);
  validateValue(addition);
  if (mode !== "overwrite" && mode !== "append")
    throw new UserEnvironmentError("Invalid environment edit mode.");
  const separator = os === "windows" ? ";" : ":";
  const needsSeparator =
    name.toUpperCase() === "PATH" &&
    current &&
    !current.endsWith(separator) &&
    !addition.startsWith(separator);
  const result =
    mode === "overwrite"
      ? addition
      : current + (needsSeparator ? separator : "") + addition;
  validateValue(result);
  return result;
}

// Fixed code only. User data travels on stdin, never as executable code or argv.
export const windowsEnvironmentScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($request.action -eq 'names') {
  @{names = @([Environment]::GetEnvironmentVariables('User').Keys)} | ConvertTo-Json -Compress
} elseif ($request.action -eq 'read') {
  @{value = [Environment]::GetEnvironmentVariable($request.name, 'User')} | ConvertTo-Json -Compress
} elseif ($request.action -eq 'write') {
  $current = [Environment]::GetEnvironmentVariable($request.name, 'User')
  if ($current -cne $request.expected) { throw 'Environment changed before confirmation.' }
  [Environment]::SetEnvironmentVariable($request.name, $request.value, 'User')
  if ([Environment]::GetEnvironmentVariable($request.name, 'User') -cne $request.value) { throw 'Environment write verification failed.' }
  @{saved = $true} | ConvertTo-Json -Compress
} else { throw 'Invalid operation.' }
`;
export type EnvironmentCommand = (
  file: string,
  args: readonly string[],
  input: string,
) => Promise<string>;
const runCommand: EnvironmentCommand = (file, args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      [...args],
      { timeout: 10_000, maxBuffer: 128_000, windowsHide: true },
      (error, stdout) => {
        if (error)
          reject(
            new UserEnvironmentError(
              "Windows user environment could not be updated or read. Check user permissions and corporate PowerShell policy; no administrator access or policy bypass was attempted.",
            ),
          );
        else resolve(stdout);
      },
    );
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input);
  });
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** No values leave this host-side adapter. No shell startup files are executed. */
export class UserEnvironment {
  public constructor(
    private readonly os: OperatingSystem,
    private readonly inherited: Readonly<NodeJS.ProcessEnv> = process.env,
    private readonly home = homedir(),
    private readonly shell = userInfo().shell || "/bin/sh",
    private readonly command: EnvironmentCommand = runCommand,
  ) {}

  public async search(query: string): Promise<readonly string[]> {
    if (query.length > 100 || /[\r\n\0]/u.test(query))
      throw new UserEnvironmentError(
        "Search by variable name, using at most 100 characters.",
      );
    if (!query.trim()) return [];
    const names = new Set(
      Object.keys(this.inherited).filter((name) =>
        environmentNamePattern.test(name),
      ),
    );
    if (this.os === "windows") {
      const result = await this.windows({ action: "names" });
      if (
        !Array.isArray(result.names) ||
        result.names.some((name) => typeof name !== "string")
      )
        throw new UserEnvironmentError(
          "Windows returned an invalid environment response.",
        );
      for (const name of result.names as string[])
        if (environmentNamePattern.test(name)) names.add(name);
    } else {
      const source = await this.readProfile(await this.profilePath());
      for (const match of (source ?? "").matchAll(
        /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]{0,99})=/gmu,
      ))
        names.add(match[1]!);
    }
    return [...names]
      .filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()))
      .sort()
      .slice(0, 50);
  }

  public async prepare(
    name: string,
    addition: string,
    mode: EnvironmentWriteMode,
  ): Promise<{ location: string; commit: () => Promise<void> }> {
    validateEnvironmentName(name);
    validateValue(addition);
    if (this.os === "windows") {
      const canonical = name.toUpperCase();
      const old = (await this.windows({ action: "read", name: canonical }))
        .value;
      if (old !== null && typeof old !== "string")
        throw new UserEnvironmentError(
          "Windows returned an invalid environment response.",
        );
      const value = environmentValue(
        canonical,
        old ?? "",
        addition,
        mode,
        this.os,
      );
      return {
        location:
          "Windows current-user environment registry (not machine settings)",
        commit: async () => {
          const result = await this.windows({
            action: "write",
            name: canonical,
            expected: old,
            value,
          });
          if (result.saved !== true)
            throw new UserEnvironmentError(
              "Windows did not confirm the user environment update.",
            );
        },
      };
    }
    const path = await this.profilePath();
    const original = await this.readProfile(path);
    const text = original ?? "";
    const begin = `# DevDashboard user environment: ${name}`;
    const end = `# End DevDashboard user environment: ${name}`;
    const lines = text.split("\n");
    const first = lines.indexOf(begin),
      last = lines.indexOf(end);
    let current = this.inherited[name] ?? "";
    if (first !== -1 || last !== -1) {
      if (
        first < 0 ||
        last !== first + 2 ||
        lines.filter((line) => line === begin || line === end).length !== 2
      )
        throw new UserEnvironmentError(
          "The managed environment block was edited or damaged. Review the startup file manually before continuing.",
        );
      const literal = lines[first + 1]!.slice(`export ${name}=`.length);
      const decoded = literal.slice(1, -1).replaceAll("'\\''", "'");
      if (lines[first + 1] !== `export ${name}=${quote(decoded)}`)
        throw new UserEnvironmentError(
          "The managed environment block is invalid. Review the startup file manually.",
        );
      current = decoded;
    }
    const value = environmentValue(name, current, addition, mode, this.os);
    const block = [begin, `export ${name}=${quote(value)}`, end];
    if (first >= 0) lines.splice(first, 3, ...block);
    const updated =
      first >= 0
        ? lines.join("\n")
        : text +
          (text.endsWith("\n") || !text ? "" : "\n") +
          block.join("\n") +
          "\n";
    return {
      location:
        path + " (future user-shell sessions, not a global GUI environment)",
      commit: async () => {
        if ((await this.readProfile(path)) !== original)
          throw new UserEnvironmentError(
            "The startup file changed while confirming. Retry after reviewing those changes.",
          );
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          const handle = await open(temporary, "wx", 0o600);
          try {
            await handle.writeFile(updated);
            await handle.sync();
          } finally {
            await handle.close();
          }
          // ponytail: compare before rename; simultaneous external editors still require coordination.
          if ((await this.readProfile(path)) !== original)
            throw new UserEnvironmentError(
              "The startup file changed during the update. No replacement was performed.",
            );
          await rename(temporary, path);
        } finally {
          await unlink(temporary).catch((error: unknown) => {
            if (!(
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "ENOENT"
            ))
              throw new UserEnvironmentError(
                "Temporary environment-file cleanup failed. Check file permissions.",
              );
          });
        }
      },
    };
  }

  private async windows(
    request: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const root =
      this.inherited.SystemRoot || this.inherited.SYSTEMROOT || "C:\\Windows";
    if (!win32.isAbsolute(root))
      throw new UserEnvironmentError(
        "Windows system directory must be absolute.",
      );
    const file = win32.join(
      root,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const result: unknown = JSON.parse(
      await this.command(
        file,
        ["-NoProfile", "-NonInteractive", "-Command", windowsEnvironmentScript],
        JSON.stringify(request),
      ),
    );
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new UserEnvironmentError("Invalid Windows environment response.");
    return result as Record<string, unknown>;
  }

  private async profilePath(): Promise<string> {
    const shell = basename(this.shell);
    if (shell === "zsh") {
      if (this.inherited.ZDOTDIR && this.inherited.ZDOTDIR !== this.home)
        throw new UserEnvironmentError(
          "Custom ZDOTDIR is not supported. Edit your zsh environment manually.",
        );
      return join(this.home, ".zshenv");
    }
    if (shell === "bash") {
      for (const name of [".bash_profile", ".bash_login"])
        if ((await this.readProfile(join(this.home, name))) !== undefined)
          return join(this.home, name);
      return join(this.home, ".profile");
    }
    if (["sh", "dash", "ksh"].includes(shell))
      return join(this.home, ".profile");
    throw new UserEnvironmentError(
      "This login shell is not supported. Persistent environment editing supports bash, zsh, sh, dash and ksh only.",
    );
  }
  private async readProfile(path: string): Promise<string | undefined> {
    try {
      const info = await lstat(path);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 1_048_576 ||
        info.uid !== userInfo().uid
      )
        throw new UserEnvironmentError(
          "Startup files must be small, regular files owned by your user. Symlinks and shared/system files are not modified.",
        );
      const bytes = await readFile(path),
        text = bytes.toString("utf8");
      if (!Buffer.from(text).equals(bytes))
        throw new UserEnvironmentError(
          "Startup file is not valid UTF-8; edit it manually.",
        );
      return text;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return undefined;
      if (error instanceof UserEnvironmentError) throw error;
      throw new UserEnvironmentError(
        "Could not read the user startup file. Check your file permissions.",
      );
    }
  }
}
