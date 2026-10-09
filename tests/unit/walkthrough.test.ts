import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext, Script } from "node:vm";
import {
  walkthroughMode,
  walkthroughVersionKey,
} from "../../src/application/services/walkthrough";
import { walkthroughScript } from "../../src/webview/app/walkthroughScript";
import { createWebviewHtml } from "../../src/webview/app/shell";
import { parseWebviewRequest } from "../../src/webview/protocol/validation";

void describe("Dashboard walkthrough", () => {
  void it("shows a first-run tour and updates only once per version", () => {
    assert.equal(walkthroughMode(undefined, "0.1.10"), "tour");
    assert.equal(walkthroughMode("0.1.9", "0.1.10"), "update");
    assert.equal(walkthroughMode("0.1.10", "0.1.10"), undefined);
    assert.equal(walkthroughVersionKey, "onboarding.lastShownVersion");
    const source = readFileSync("src/extension/extension.ts", "utf8");
    assert.match(
      source,
      /context\.globalState\.update\(\s*walkthroughVersionKey,\s*version/u,
    );
    assert.match(source, /walkthroughShown = true/u);
  });

  void it("validates replay without allowing webview-supplied state or version", () => {
    assert.equal(parseWebviewRequest({ type: "walkthrough.open" }).ok, true);
    assert.equal(
      parseWebviewRequest({ type: "walkthrough.open", version: "0.1.10" }).ok,
      false,
    );
    assert.equal(
      parseWebviewRequest({ type: "walkthrough.open", mode: "tour" }).ok,
      false,
    );
    assert.equal(parseWebviewRequest({ type: "walkthrough.finish" }).ok, false);
    const html = createWebviewHtml("vscode-webview://test");
    assert.match(html, /\.walkthrough\[hidden\]\{display:none\}/u);
    assert.doesNotMatch(walkthroughScript, /innerHTML|fetch\(|eval\(/u);
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(
      html,
    )?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Script(script));
  });

  void it("navigates every page, supports back/skip/escape/replay and restores the original page", () => {
    class Element {
      public className = "";
      public textContent = "";
      public hidden = false;
      public disabled = false;
      public dataset = { view: "" };
      public children: Element[] = [];
      public listeners = new Map<string, () => void>();
      public attributes = new Map<string, string>();
      public focused = false;
      public classes = new Set<string>();
      public classList = {
        add: (value: string) => this.classes.add(value),
        remove: (value: string) => this.classes.delete(value),
      };
      public append(...elements: Element[]): void {
        this.children.push(...elements);
      }
      public setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
      }
      public addEventListener(name: string, listener: () => void): void {
        this.listeners.set(name, listener);
      }
      public focus(): void {
        this.focused = true;
      }
      public click(): void {
        this.listeners.get("click")?.();
      }
    }
    let page = "notes",
      flushes = 0;
    const body = new Element(),
      header = new Element(),
      visible = new Element();
    const targets = new Map<string, Element>();
    const windowListeners = new Map<
      string,
      (event: { data: unknown }) => void
    >();
    const documentListeners = new Map<
      string,
      (event: { key: string; preventDefault: () => void }) => void
    >();
    const requests: { type: string; page?: string }[] = [];
    runInNewContext(walkthroughScript, {
      document: {
        body,
        createElement: () => new Element(),
        querySelector: (selector: string) => {
          if (selector === ".header-tools") return header;
          if (selector === "[data-view]:not([hidden])") {
            visible.dataset.view = page;
            return visible;
          }
          if (selector === "dialog[open]") return null;
          if (!targets.has(selector)) targets.set(selector, new Element());
          return targets.get(selector);
        },
        querySelectorAll: () =>
          [...targets.values()].filter((element) =>
            element.classes.has("walkthrough-target"),
          ),
        addEventListener: (
          type: string,
          listener: (event: {
            key: string;
            preventDefault: () => void;
          }) => void,
        ) => documentListeners.set(type, listener),
      },
      window: {
        addEventListener: (
          type: string,
          listener: (event: { data: unknown }) => void,
        ) => windowListeners.set(type, listener),
      },
      vscode: {
        postMessage: (message: { type: string; page?: string }) =>
          requests.push(message),
      },
      iconButton: (_icon: string, label: string, action: () => void) => {
        const element = new Element();
        element.setAttribute("data-icon", _icon);
        element.setAttribute("aria-label", label);
        element.addEventListener("click", action);
        return element;
      },
      flushAutosave: () => {
        flushes++;
      },
      selectPage: (selected: string) => {
        page = selected;
      },
    });
    const send = (mode: string) =>
      windowListeners.get("message")!({
        data: { type: "walkthrough.state", mode, version: "0.1.10" },
      });
    const panel = body.children[0]!;
    assert.equal(header.children[0]?.attributes.get("data-icon"), "help");
    assert.equal(
      header.children[0]?.attributes.get("aria-label"),
      "Show starter guide",
    );
    const [, back, next] = panel.children[3]!.children;
    assert.equal(panel.hidden, true);
    send("invalid");
    assert.equal(panel.hidden, true);
    send("tour");
    assert.equal(page, "home");
    assert.equal(back!.disabled, true);
    next!.click();
    assert.equal(page, "settings");
    back!.click();
    assert.equal(page, "home");
    for (const expected of [
      "settings",
      "jira",
      "calendar",
      "settings",
      "workspace",
      "notes",
      "knowledge",
      "search",
    ]) {
      next!.click();
      assert.equal(page, expected);
    }
    assert.equal(next!.textContent, "Finish");
    next!.click();
    assert.equal(panel.hidden, true);
    assert.equal(page, "notes");
    send("update");
    assert.match(panel.children[0]!.textContent, /What's new.*1 of 1/u);
    assert.equal(page, "settings");
    assert.match(panel.children[2]!.textContent, /extension-host proxy route/u);
    assert.equal(next!.textContent, "Finish");
    next!.click();
    assert.equal(page, "notes");
    send("tour");
    documentListeners.get("keydown")!({
      key: "Escape",
      preventDefault: () => {},
    });
    assert.equal(panel.hidden, true);
    assert.equal(page, "notes");
    header.children[0].click();
    assert.equal(requests.at(-1)?.type, "walkthrough.open");
    assert.ok(flushes > 0);
    assert.ok(
      requests.every((request) =>
        ["navigation.select", "walkthrough.open"].includes(request.type),
      ),
    );
    assert.ok(
      [...targets.values()].every(
        (target) => !target.classes.has("walkthrough-target"),
      ),
    );
  });
});
