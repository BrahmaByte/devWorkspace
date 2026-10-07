import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";
import { dashboardInteractionsScript } from "../../src/webview/app/dashboardInteractionsScript";
import { createWebviewHtml } from "../../src/webview/app/shell";

class Element {
  public children: Element[] = [];
  public dataset: Record<string, string> = {};
  public attributes: Record<string, string> = {};
  public classes = new Set<string>();
  public classList = {
    toggle: (name: string, enabled: boolean) =>
      enabled ? this.classes.add(name) : this.classes.delete(name),
    remove: (name: string) => this.classes.delete(name),
  };
  public listeners: Record<string, (event?: unknown) => void> = {};
  public value = "";
  public checked = false;
  public hidden = false;
  public textContent = "";
  public append(...children: Element[]) {
    this.children.push(...children);
  }
  public replaceChildren() {
    this.children = [];
  }
  public setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  public addEventListener(name: string, callback: (event?: unknown) => void) {
    this.listeners[name] = callback;
  }
  public scrollIntoView() {}
  public focus() {}
  public reset() {
    this.value = "";
  }
}

void describe("dashboard interactions", () => {
  void it("navigates from recent work, highlights an out-of-filter issue and keeps the saved filter", () => {
    const nodes = new Map<string, Element>();
    const querySelector = (selector: string) => {
      if (!nodes.has(selector)) nodes.set(selector, new Element());
      return nodes.get(selector)!;
    };
    const flatten = (element: Element): Element[] => [
      element,
      ...element.children.flatMap(flatten),
    ];
    const messages: unknown[] = [];
    const opened: string[] = [];
    const listeners: Array<(event: unknown) => void> = [];
    const context = createContext({
      document: {
        querySelector,
        addEventListener: () => {},
        querySelectorAll: (selector: string) =>
          selector === "#jira-filter-fields button"
            ? querySelector("#jira-filter-fields").children
            : flatten(querySelector("#jira-issues")).filter(
                (row) => row.dataset.issueKey,
              ),
        createElement: () => new Element(),
      },
      window: {
        addEventListener: (_: string, handler: (event: unknown) => void) =>
          listeners.push(handler),
      },
      vscode: { postMessage: (message: unknown) => messages.push(message) },
      homeEmpty: (node: Element, text: string) => {
        const row = new Element();
        row.textContent = text;
        node.append(row);
      },
      homeRow: (
        _icon: string,
        _key: string,
        _summary: string,
        click: () => void,
      ) => {
        const row = new Element();
        row.addEventListener("click", click);
        return row;
      },
      selectPage: () => {
        querySelector('[data-view="jira"]').hidden = false;
      },
      updateClock: () => {},
      openJiraIssue: (key: string) => opened.push(key),
      jiraSyncPending: false,
      jiraDisplayName: "",
      iconButton: () => new Element(),
    });
    runInContext(dashboardInteractionsScript, context);
    runInContext(
      `
      const issues=[
        {key:"DEV-1",summary:"Alpha",assignee:"Ada",status:"To Do",issueType:"Task",parentKey:"DEV-9",labels:["api","urgent"]},
        {key:"DEV-2",summary:"Beta",status:"Done",issueType:"Story",labels:[]}
      ];
      jiraBoardSelections={assignee:["Ada"],labels:["api","urgent"]};
    `,
      context,
    );
    assert.equal(runInContext("jiraFilteredIssues(issues).length", context), 1);
    runInContext('jiraBoardSelections.status=["Done"]', context);
    assert.equal(runInContext("jiraFilteredIssues(issues).length", context), 0);
    runInContext('jiraBoardSelections={assignee:["Unassigned"]}', context);
    assert.equal(
      runInContext("jiraFilteredIssues(issues)[0].key", context),
      "DEV-2",
    );
    assert.equal(
      runInContext(
        'jiraBoardMatches({summary:"Local",status:"Done"},true)',
        context,
      ),
      false,
    );
    runInContext('jiraBoardSelections={};jiraBoardSearch="beta"', context);
    assert.equal(
      runInContext("jiraFilteredIssues(issues)[0].key", context),
      "DEV-2",
    );
    runInContext('jiraBoardSearch=""', context);
    const renderLine = createWebviewHtml("vscode-webview://test")
      .split("\n")
      .find((line) => line.startsWith("function renderJira("))!;
    runInContext(renderLine, context);
    runInContext(
      'const state={connection:{displayName:"Jira",baseUrl:"https://jira.example.test"},issues:[],localCards:[],filter:"project = OTHER"};renderJira(state);renderRecentJira([{key:"DEV-7",summary:"Recent",status:"Done",updatedAt:"2026-10-07T00:00:00Z"}]);',
      context,
    );
    querySelector("#home-jira").children[0]!.listeners.click!();
    assert.equal(
      JSON.stringify(messages.at(-1)),
      JSON.stringify({ type: "navigation.select", page: "jira" }),
    );
    const selected = flatten(querySelector("#jira-issues")).find(
      (row) => row.dataset.issueKey === "DEV-7",
    )!;
    assert.equal(selected.classes.has("jira-highlighted"), true);
    assert.equal(selected.attributes["aria-pressed"], "true");
    assert.ok(
      selected.children.some((child) =>
        child.textContent.includes("outside current filter"),
      ),
    );
    assert.equal(
      runInContext("latestJiraState.filter", context),
      "project = OTHER",
    );
    assert.equal(querySelector("#jira-filter-fields").children.length, 5);
    selected.listeners.click!();
    assert.deepEqual(opened, ["DEV-7"]);
    runInContext("renderJira(state)", context);
    assert.ok(
      flatten(querySelector("#jira-issues")).some((row) =>
        row.classes.has("jira-highlighted"),
      ),
    );
    runInContext(
      'renderJira({issues:[],localCards:[],filter:"project = OTHER"})',
      context,
    );
    assert.equal(
      flatten(querySelector("#jira-issues")).some(
        (row) => row.dataset.issueKey,
      ),
      false,
    );
    runInContext(
      'editUrlGroup({id:"group",name:"Tools",urls:["https://one.test","https://two.test"]})',
      context,
    );
    assert.equal(querySelector("#url-group-name").value, "Tools");
    assert.equal(
      querySelector("#url-group-urls").value,
      "https://one.test\nhttps://two.test",
    );
    listeners.forEach((listener) =>
      listener({ data: { type: "error", message: "Save failed" } }),
    );
    assert.equal(querySelector("#url-group-form").hidden, false);
    listeners.forEach((listener) => listener({ data: { type: "urls.saved" } }));
    assert.equal(querySelector("#url-group-form").hidden, true);
    runInContext(
      "latestJiraState={...state,issues};renderJira(latestJiraState)",
      context,
    );
    querySelector("#jira-filter-fields").children[1]!.listeners.click!();
    const assignee = querySelector("#jira-filter-options").children[1]!;
    assert.equal(assignee.children[1]!.textContent, "Ada");
    assignee.children[0]!.checked = true;
    assignee.children[0]!.listeners.change!();
    assert.equal(runInContext("jiraFilteredIssues(issues).length", context), 1);
    assert.equal(querySelector("#jira-filter-count").textContent, "1 active");
    assert.equal(
      runInContext("latestJiraState.filter", context),
      "project = OTHER",
    );
    runInContext("jiraSyncPending=true;refreshJiraBoardFilters()", context);
    assert.equal(runInContext("jiraSyncPending", context), true);
    querySelector("#jira-filter-clear").listeners.click!();
    assert.equal(runInContext("jiraFilteredIssues(issues).length", context), 2);
    assert.equal(querySelector("#jira-filter-count").textContent, "");
    assert.equal(
      messages.some(
        (message) => (message as { type: string }).type === "jira.preset",
      ),
      false,
    );
  });
});
