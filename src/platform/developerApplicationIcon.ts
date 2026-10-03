import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import type { OperatingSystem } from "./platformService";

const execute = promisify(execFile);
const maximumIconBytes = 512 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function pngIconData(bytes: Buffer): string | undefined {
  if (
    bytes.length > maximumIconBytes ||
    !bytes.subarray(0, 8).equals(pngSignature)
  )
    return undefined;
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

/** Only reads icons for host-registered apps; never exposes filesystem paths. */
export class DeveloperApplicationIconProvider {
  private readonly cache = new Map<string, Promise<string | undefined>>();

  public constructor(private readonly operatingSystem: OperatingSystem) {}

  public getIcon(executablePath: string): Promise<string | undefined> {
    let icon = this.cache.get(executablePath);
    if (!icon) {
      icon = this.loadIcon(executablePath).catch(() => undefined);
      this.cache.set(executablePath, icon);
    }
    return icon;
  }

  private async loadIcon(executablePath: string): Promise<string | undefined> {
    if (this.operatingSystem === "windows") {
      // Path is passed as environment data, never interpolated into script code.
      const script = [
        "Add-Type -AssemblyName System.Drawing",
        "$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:DEVDASHBOARD_ICON_PATH)",
        "if ($null -eq $icon) { exit 0 }",
        "$bitmap = $icon.ToBitmap()",
        "$stream = New-Object System.IO.MemoryStream",
        "try { $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($stream.ToArray()) } finally { $stream.Dispose(); $bitmap.Dispose(); $icon.Dispose() }",
      ].join("; ");
      const { stdout } = await execute(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          env: { ...process.env, DEVDASHBOARD_ICON_PATH: executablePath },
          timeout: 5_000,
          maxBuffer: maximumIconBytes * 2,
          windowsHide: true,
        },
      );
      return pngIconData(Buffer.from(stdout.trim(), "base64"));
    }
    if (this.operatingSystem === "macos") {
      const bundle = executablePath.match(/^(.*?\.app)(?:\/|$)/iu)?.[1];
      if (!bundle) return undefined;
      const resources = join(bundle, "Contents", "Resources");
      const { stdout } = await execute(
        "/usr/bin/plutil",
        [
          "-extract",
          "CFBundleIconFile",
          "raw",
          "-o",
          "-",
          join(bundle, "Contents", "Info.plist"),
        ],
        { timeout: 3_000, maxBuffer: 4_096 },
      );
      const iconName = stdout.trim();
      if (!iconName || basename(iconName) !== iconName) return undefined;
      const source = join(
        resources,
        iconName.endsWith(".icns") ? iconName : `${iconName}.icns`,
      );
      const temporary = await mkdtemp(join(tmpdir(), "developer-app-icon-"));
      try {
        const target = join(temporary, "icon.png");
        await execute(
          "/usr/bin/sips",
          ["-s", "format", "png", "-Z", "96", source, "--out", target],
          { timeout: 5_000, maxBuffer: 4_096 },
        );
        return pngIconData(await readFile(target));
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
    return this.linuxIcon(executablePath);
  }

  private async linuxIcon(executablePath: string): Promise<string | undefined> {
    const applicationDirectories = [
      join(homedir(), ".local", "share", "applications"),
      "/usr/local/share/applications",
      "/usr/share/applications",
    ];
    const executableName = basename(executablePath);
    for (const directory of applicationDirectories) {
      const entries = await readdir(directory).catch(() => []);
      for (const entry of entries
        .filter((name) => name.endsWith(".desktop"))
        .slice(0, 500)) {
        const desktopPath = join(directory, entry);
        if ((await stat(desktopPath)).size > 64 * 1024) continue;
        const desktop = await readFile(desktopPath, "utf8");
        const command = /^Exec=(?:"([^"]+)"|(\S+))/mu.exec(desktop);
        const program = command?.[1] ?? command?.[2];
        if (
          !program ||
          (program !== executablePath && program !== executableName)
        )
          continue;
        const icon = /^Icon=(.+)$/mu.exec(desktop)?.[1]?.trim();
        if (!icon) continue;
        const candidates = icon.startsWith("/")
          ? [icon]
          : [
              join(dirname(executablePath), `${icon}.png`),
              ...[
                join(homedir(), ".local", "share", "icons"),
                "/usr/share/icons",
              ].flatMap((root) =>
                ["hicolor", "Adwaita"].flatMap((theme) =>
                  ["96x96", "128x128", "64x64", "48x48", "256x256"].map(
                    (size) => join(root, theme, size, "apps", `${icon}.png`),
                  ),
                ),
              ),
              join(
                "/usr/share/pixmaps",
                icon.endsWith(".png") ? icon : `${icon}.png`,
              ),
            ];
        for (const candidate of candidates) {
          try {
            if ((await stat(resolve(candidate))).size > maximumIconBytes)
              continue;
            const data = pngIconData(await readFile(candidate));
            if (data) return data;
          } catch {
            /* Try the next installed icon size. */
          }
        }
      }
    }
    return undefined;
  }
}
