import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  launchMacApplication,
  type MacApplicationCommand,
} from "../../src/platform/macApplicationLauncher";

void describe("macOS bundle launches", () => {
  void it("tracks the app returned by Launch Services and closes that identity", async () => {
    const calls: string[] = [];
    const command: MacApplicationCommand = (action, path, identity) => {
      calls.push(action);
      assert.equal(path, "/Applications/Developer Tool.app");
      if (action === "launch")
        return Promise.resolve(
          JSON.stringify({ pid: 1234, date: 5678, owned: true }),
        );
      assert.deepEqual(identity, { pid: 1234, date: 5678, owned: true });
      return Promise.resolve(JSON.stringify({ running: false }));
    };
    const app = await launchMacApplication(
      "/Applications/Developer Tool.app",
      command,
    );
    assert.equal(app.canClose, true);
    await app.close();
    await app.exited;
    assert.deepEqual(calls, ["launch", "close", "status"]);
  });

  void it("does not allow closing an already-running app", async () => {
    const calls: string[] = [];
    const command: MacApplicationCommand = (action) => {
      calls.push(action);
      return Promise.resolve(
        JSON.stringify({ pid: 1234, date: 5678, owned: false }),
      );
    };
    const app = await launchMacApplication(
      "/Applications/Existing.app",
      command,
    );
    assert.equal(app.canClose, false);
    await assert.rejects(app.close(), /already running/u);
    app.dispose?.();
    assert.deepEqual(calls, ["launch"]);
  });

  void it("rejects invalid launch identities", async () => {
    for (const result of [
      { pid: -1, date: 1, owned: true },
      { pid: 1234, owned: true },
      { pid: 1234, date: 1, owned: "true" },
    ]) {
      await assert.rejects(
        launchMacApplication("/Applications/Tool.app", () =>
          Promise.resolve(JSON.stringify(result)),
        ),
        /Invalid application launch result/u,
      );
    }
  });
});
