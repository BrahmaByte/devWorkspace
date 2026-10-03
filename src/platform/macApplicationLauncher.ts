import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ManagedApplicationProcess } from "../application/services/developerApplicationService";

const executeFile = promisify(execFile);

// Fixed code, with the selected bundle path and process identity passed as argv.
export const macApplicationScript = `
ObjC.import('AppKit');
function run(argv) {
  const path = argv[1];
  const workspace = $.NSWorkspace.sharedWorkspace;
  function sameBundle(app) {
    return app && !app.isTerminated && app.bundleURL && ObjC.unwrap(app.bundleURL.path) === path;
  }
  function identity(app) {
    return {pid:Number(app.processIdentifier), date:app.launchDate ? Number(app.launchDate.timeIntervalSince1970) : null};
  }
  if (argv[0] === 'launch') {
    const apps = workspace.runningApplications;
    const previous = [];
    for (let i=0;i<apps.count;i++) { const app=apps.objectAtIndex(i); if(sameBundle(app)) previous.push(Number(app.processIdentifier)); }
    const error = Ref();
    const app = workspace.launchApplicationAtURLOptionsConfigurationError($.NSURL.fileURLWithPath(path), 0, $.NSDictionary.dictionary, error);
    if (!sameBundle(app)) throw Error('Application launch failed.');
    app.activateWithOptions(2);
    return JSON.stringify({...identity(app), owned:previous.indexOf(Number(app.processIdentifier)) === -1});
  }
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[2]));
  const expectedDate = argv[3];
  const matches = Boolean(sameBundle(app) && String(identity(app).date) === expectedDate);
  if (argv[0] === 'status') return JSON.stringify({running:matches});
  if (!matches) return JSON.stringify({running:false});
  if (!app.terminate) throw Error('Application refused to quit.');
  return JSON.stringify({running:true});
}`;

export interface MacApplicationIdentity {
  readonly pid: number;
  readonly date: number | null;
  readonly owned: boolean;
}

export type MacApplicationCommand = (
  action: "launch" | "status" | "close",
  bundlePath: string,
  identity?: MacApplicationIdentity,
) => Promise<string>;

const runApplicationCommand: MacApplicationCommand = async (
  action,
  bundlePath,
  identity,
) => {
  const { stdout } = await executeFile(
    "/usr/bin/osascript",
    [
      "-l",
      "JavaScript",
      "-e",
      macApplicationScript,
      action,
      bundlePath,
      ...(identity ? [String(identity.pid), String(identity.date)] : []),
    ],
    { timeout: 15_000, maxBuffer: 4_096 },
  );
  return stdout;
};

class MacManagedApplication implements ManagedApplicationProcess {
  public readonly exited: Promise<void>;
  public readonly canClose: boolean;
  private timer?: NodeJS.Timeout;
  private disposed = false;
  private finish: () => void = () => undefined;

  public constructor(
    private readonly bundlePath: string,
    private readonly identity: MacApplicationIdentity,
    private readonly command: MacApplicationCommand,
  ) {
    this.canClose = identity.owned && identity.date !== null;
    this.exited = new Promise((complete) => {
      this.finish = complete;
    });
    this.scheduleCheck();
  }

  public async close(): Promise<void> {
    if (!this.canClose)
      throw new Error("This application was already running.");
    await this.command("close", this.bundlePath, this.identity);
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!(await this.isRunning())) {
        this.dispose();
        this.finish();
        return;
      }
      await new Promise((complete) => setTimeout(complete, 500));
    }
    throw new Error(
      "The application is waiting to close. Save any unsaved work.",
    );
  }

  public dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async isRunning(): Promise<boolean> {
    const result: unknown = JSON.parse(
      await this.command("status", this.bundlePath, this.identity),
    );
    if (
      !result ||
      typeof result !== "object" ||
      !("running" in result) ||
      typeof result.running !== "boolean"
    )
      throw new Error("Invalid application status.");
    return result.running;
  }

  private scheduleCheck(): void {
    if (this.disposed) return;
    this.timer = setTimeout(() => {
      void this.isRunning()
        .then((running) => {
          if (running) this.scheduleCheck();
          else {
            this.dispose();
            this.finish();
          }
        })
        .catch(() => this.scheduleCheck());
    }, 3_000);
    this.timer.unref();
  }
}

export async function launchMacApplication(
  bundlePath: string,
  command: MacApplicationCommand = runApplicationCommand,
): Promise<ManagedApplicationProcess> {
  const identity: unknown = JSON.parse(await command("launch", bundlePath));
  if (
    !identity ||
    typeof identity !== "object" ||
    !("pid" in identity) ||
    !Number.isSafeInteger(identity.pid) ||
    Number(identity.pid) <= 0 ||
    !("date" in identity) ||
    (identity.date !== null &&
      (typeof identity.date !== "number" || !Number.isFinite(identity.date))) ||
    !("owned" in identity) ||
    typeof identity.owned !== "boolean"
  )
    throw new Error("Invalid application launch result.");
  return new MacManagedApplication(
    bundlePath,
    identity as MacApplicationIdentity,
    command,
  );
}
