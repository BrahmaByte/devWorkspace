import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";

void it("stores IDE paths only in the host and asks which IDE opens each project", async () => {
  const values = new Map<string, unknown>();
  const calls: unknown[] = [];
  let selectedIde = "IntelliJ IDEA";
  const globalState = {
    get: (key: string, fallback: unknown) => values.get(key) ?? fallback,
    update: (key: string, value: unknown) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
  const vscode = {
    Uri: { file: (path: string) => ({ fsPath: path }) },
    commands: {
      executeCommand: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve();
      },
    },
    window: {
      showOpenDialog: () =>
        Promise.resolve([{ fsPath: "/fake/apps/intellij" }]),
      showQuickPick: (items: { label: string }[]) =>
        Promise.resolve(items.find((item) => item.label === selectedIde)),
    },
  };
  const external = {
    inspect: (path: string) => {
      calls.push(["inspect", path]);
      return Promise.resolve({ name: "IntelliJ IDEA" });
    },
    openPath: (application: string, project: string) => {
      calls.push(["open", application, project]);
      return Promise.resolve();
    },
  };
  const exports: Record<string, unknown> = {};
  runInNewContext(
    readFileSync(
      "dist/src/infrastructure/vscode/vscodeProjectWorkspaceGateway.js",
      "utf8",
    ),
    {
      exports,
      process: { platform: "linux" },
      require: (name: string) =>
        name === "vscode"
          ? vscode
          : name === "node:crypto"
            ? { randomUUID: () => "00000000-0000-4000-8000-000000000001" }
            : { NodeDeveloperApplicationProcessGateway: class {} },
    },
  );
  const Gateway = exports.VscodeProjectWorkspaceGateway as new (
    state: typeof globalState,
    operatingSystem: string,
    process: typeof external,
  ) => {
    ides(): readonly { id: string; name: string }[];
    configure(): Promise<void>;
    remove(id: string): Promise<void>;
    openProject(path: string): Promise<void>;
  };
  const gateway = new Gateway(globalState, "linux", external);
  assert.deepEqual(JSON.parse(JSON.stringify(gateway.ides())), [
    { id: "vscode", name: "Visual Studio Code" },
  ]);
  await gateway.configure();
  assert.deepEqual(JSON.parse(JSON.stringify(gateway.ides())), [
    { id: "vscode", name: "Visual Studio Code" },
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "IntelliJ IDEA",
    },
  ]);
  assert.equal(JSON.stringify(gateway.ides()).includes("/fake/apps"), false);
  await assert.rejects(gateway.configure(), /already configured/u);
  await gateway.openProject("/fake/project with spaces");
  assert.deepEqual(calls.at(-1), [
    "open",
    "/fake/apps/intellij",
    "/fake/project with spaces",
  ]);
  selectedIde = "Visual Studio Code";
  await gateway.openProject("/fake/project");
  assert.equal(
    JSON.stringify(calls.at(-1)),
    JSON.stringify([
      "vscode.openFolder",
      { fsPath: "/fake/project" },
      { forceNewWindow: true },
    ]),
  );
  await gateway.remove("00000000-0000-4000-8000-000000000001");
  assert.equal(gateway.ides().length, 1);
});
