export type OperatingSystem = "windows" | "macos" | "linux";

export interface PlatformService {
  readonly operatingSystem: OperatingSystem;
  readonly pathSeparator: "\\" | "/";
  readonly defaultShell: "powershell.exe" | "/bin/zsh" | "/bin/sh";
}

export function createPlatformService(
  platform: NodeJS.Platform = process.platform,
): PlatformService {
  switch (platform) {
    case "win32":
      return {
        operatingSystem: "windows",
        pathSeparator: "\\",
        defaultShell: "powershell.exe",
      };
    case "darwin":
      return {
        operatingSystem: "macos",
        pathSeparator: "/",
        defaultShell: "/bin/zsh",
      };
    default:
      return {
        operatingSystem: "linux",
        pathSeparator: "/",
        defaultShell: "/bin/sh",
      };
  }
}
