import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { dashboardZoomScript } from "../../src/webview/app/dashboardZoomScript";

void describe("Dashboard zoom", () => {
  void it("restores, clamps and resets zoom without changing card preferences", () => {
    const listeners = new Map<string, () => void>();
    const events = new Map<string, (event: Record<string, unknown>) => void>();
    const controls = new Map<
      string,
      {
        textContent: string;
        disabled: boolean;
        addEventListener: (type: string, listener: () => void) => void;
      }
    >();
    for (const id of ["zoom-in", "zoom-out", "zoom-reset"])
      controls.set("#" + id, {
        textContent: "",
        disabled: false,
        addEventListener: (_type, listener) => {
          listeners.set(id, listener);
        },
      });
    const style: { zoom?: string; setProperty: () => void } = {
      setProperty: () => {},
    };
    const state = {
      zoom: 120,
      cardLayouts: { sample: { width: "500px", height: "300px" } },
    };
    runInNewContext(dashboardZoomScript, {
      document: {
        documentElement: { style },
        querySelector: (id: string) => controls.get(id),
        addEventListener: (
          type: string,
          listener: (event: Record<string, unknown>) => void,
        ) => {
          events.set(type, listener);
        },
      },
      savedState: state,
      vscode: { setState: () => {} },
    });
    assert.equal(style.zoom, "1.2");
    listeners.get("zoom-in")!();
    assert.equal(state.zoom, 130);
    for (let i = 0; i < 10; i++) listeners.get("zoom-in")!();
    assert.equal(state.zoom, 150);
    assert.equal(controls.get("#zoom-in")!.disabled, true);
    for (let i = 0; i < 10; i++) listeners.get("zoom-out")!();
    assert.equal(state.zoom, 80);
    assert.equal(controls.get("#zoom-out")!.disabled, true);
    listeners.get("zoom-reset")!();
    assert.equal(state.zoom, 100);
    let prevented = false;
    events.get("keydown")!({
      ctrlKey: true,
      key: "+",
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(state.zoom, 110);
    assert.equal(prevented, true);
    events.get("wheel")!({
      metaKey: true,
      deltaY: 1,
      preventDefault: () => {},
    });
    assert.equal(state.zoom, 100);
    assert.deepEqual(state.cardLayouts, {
      sample: { width: "500px", height: "300px" },
    });
  });
});
