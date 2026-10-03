import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";

import type {
  DeveloperApplicationProcessGateway,
  ManagedApplicationProcess,
} from "../application/services/developerApplicationService";
import type { OperatingSystem } from "./platformService";
import { launchMacApplication } from "./macApplicationLauncher";

function displayName(executablePath: string): string {
  const name = basename(executablePath);
  const extension = extname(name).toLowerCase();
  return extension === ".app" || extension === ".exe"
    ? name.slice(0, -extension.length)
    : name;
}

const executeFile = promisify(execFile);

async function macApplicationExecutable(
  applicationPath: string,
): Promise<string> {
  const infoPath = join(applicationPath, "Contents", "Info.plist");
  const { stdout } = await executeFile("/usr/bin/plutil", [
    "-extract",
    "CFBundleExecutable",
    "raw",
    "-o",
    "-",
    infoPath,
  ]);
  const executableName = stdout.trim();
  if (!executableName || !/^[^/\\\0]+$/u.test(executableName))
    throw new Error("The selected macOS application cannot be inspected.");
  return join(applicationPath, "Contents", "MacOS", executableName);
}

class ChildManagedApplicationProcess implements ManagedApplicationProcess {
  public readonly exited: Promise<void>;

  public constructor(private readonly child: ChildProcess) {
    this.exited = new Promise((complete) => {
      child.once("exit", () => complete());
    });
  }

  public async close(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    if (!this.child.kill("SIGTERM"))
      throw new Error("The application could not be closed.");
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.exited,
        new Promise<void>((_complete, reject) => {
          timeout = setTimeout(
            () => reject(new Error("The application did not close in time.")),
            5_000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

export class NodeDeveloperApplicationProcessGateway implements DeveloperApplicationProcessGateway {
  public constructor(private readonly operatingSystem: OperatingSystem) {}

  public async inspect(
    executablePath: string,
  ): Promise<{ readonly name: string }> {
    const selectedPath = resolve(executablePath.trim());
    const selectedStat = await stat(selectedPath);
    if (
      this.operatingSystem === "macos" &&
      selectedStat.isDirectory() &&
      selectedPath.toLowerCase().endsWith(".app")
    ) {
      const executable = await macApplicationExecutable(selectedPath);
      await access(executable, constants.X_OK);
      return { name: displayName(selectedPath) };
    }
    if (!selectedStat.isFile())
      throw new Error("Select an application executable file.");
    if (
      this.operatingSystem === "windows" &&
      extname(selectedPath).toLowerCase() !== ".exe"
    )
      throw new Error("Select a Windows application executable (.exe).");
    if (this.operatingSystem !== "windows")
      await access(selectedPath, constants.X_OK);
    return { name: displayName(selectedPath) };
  }

  public async launch(
    executablePath: string,
  ): Promise<ManagedApplicationProcess> {
    const selectedPath = resolve(executablePath);
    const selectedStat = await stat(selectedPath);
    if (
      this.operatingSystem === "macos" &&
      selectedStat.isDirectory() &&
      selectedPath.toLowerCase().endsWith(".app")
    )
      return launchMacApplication(selectedPath);
    const child = spawn(selectedPath, [], {
      detached: false,
      shell: false,
      stdio: "ignore",
      windowsHide: false,
    });
    await new Promise<void>((complete, reject) => {
      child.once("spawn", complete);
      child.once("error", reject);
    });
    return new ChildManagedApplicationProcess(child);
  }
}
