import assert from "node:assert/strict";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import { calendarScript } from "../../src/webview/app/calendarScript";

void it("navigates calendar views, retains failed drafts and keeps leave units separate", () => {
  class Element {
    public value = "";
    public step = "";
    public hidden = false;
    public disabled = false;
    public required = false;
    public textContent = "";
    public className = "";
    public dataset: Record<string, string> = {};
    public style: Record<string, string> = {};
    public children: Element[] = [];
    public scrollTop = 0;
    public classList = { toggle: () => {} };
    public listeners = new Map<
      string,
      (event: { preventDefault(): void }) => void
    >();
    public append(...elements: Element[]): void {
      this.children.push(...elements);
    }
    public replaceChildren(...elements: Element[]): void {
      this.children = elements;
    }
    public setAttribute(): void {}
    public focus(): void {}
    public addEventListener(
      name: string,
      listener: (event: { preventDefault(): void }) => void,
    ): void {
      this.listeners.set(name, listener);
    }
    public fire(name: string): void {
      this.listeners.get(name)?.({ preventDefault() {} });
    }
  }
  const elements = new Map<string, Element>();
  const get = (key: string) => {
    if (!elements.has(key)) elements.set(key, new Element());
    return elements.get(key)!;
  };
  const fields = new Map<string, Element>();
  const field = (name: string) => {
    if (!fields.has(name)) fields.set(name, new Element());
    return fields.get(name)!;
  };
  const form = get("#calendar-form");
  Object.assign(form, {
    elements: { namedItem: field },
    reset: () => {
      fields.forEach((element) => (element.value = ""));
      field("kind").value = "plan";
      field("color").value = "blue";
    },
  });
  const typeForm = get("#calendar-type-form");
  Object.assign(typeForm, {
    elements: { namedItem: (name: string) => get("type-" + name) },
    reset: () => {},
  });
  const views = ["day", "week", "month"].map((view) => {
    const button = new Element();
    button.dataset.calendarView = view;
    return button;
  });
  const root = {
    querySelector: get,
    querySelectorAll: (selector: string) =>
      selector === "[data-calendar-view]" ? views : [],
  };
  const requests: { type: string; year: number; entry?: unknown }[] = [];
  let onMessage: (event: { data: unknown }) => void = () => {};
  runInNewContext(calendarScript, {
    document: { querySelector: () => root, createElement: () => new Element() },
    savedState: {},
    vscode: {
      setState() {},
      postMessage: (request: { type: string; year: number; entry?: unknown }) =>
        requests.push(request),
    },
    iconButton: (_icon: string, _title: string, action: () => void) => {
      const button = new Element();
      button.addEventListener("click", action);
      return button;
    },
    window: {
      addEventListener: (_name: string, handler: typeof onMessage) =>
        (onMessage = handler),
    },
  });
  onMessage({ data: { type: "shell.state", page: "calendar" } });
  const year = requests.find(
    (request) => request.type === "calendar.refresh",
  )!.year;
  const today = new Date(),
    date = [
      year,
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");
  const annual = "00000000-0000-4000-8000-000000000001",
    hourly = "00000000-0000-4000-8000-000000000002";
  onMessage({
    data: {
      type: "calendar.state",
      state: {
        year,
        leaveTypes: [
          {
            id: annual,
            name: "Annual",
            unit: "days",
            count: 20,
            color: "teal",
          },
          {
            id: hourly,
            name: "Appointment",
            unit: "hours",
            count: 8,
            color: "pink",
          },
        ],
        entries: [
          {
            id: "a",
            kind: "leave",
            title: "Half day",
            startDate: date,
            endDate: date,
            startTime: "",
            endTime: "",
            leaveTypeId: annual,
            quantity: 0.5,
          },
          {
            id: "b",
            kind: "leave",
            title: "Appointment",
            startDate: date,
            endDate: date,
            startTime: "",
            endTime: "",
            leaveTypeId: hourly,
            quantity: 2,
          },
        ],
      },
    },
  });
  assert.deepEqual(
    get("#calendar-totals").children.map((child) => child.textContent),
    [
      "Annual · 0.5 days used · 19.5 days remaining / 20",
      "Appointment · 2 hours used · 6 hours remaining / 8",
    ],
  );
  views[2]!.fire("click");
  get("#calendar-type-list").children[1]!.children[1]!.fire("click");
  assert.equal(get("type-count").step, "any");
  assert.equal(get("type-color").value, "pink");
  assert.equal(get("#calendar-body").children[0]!.children.length, 49);
  assert.equal(get("#calendar-year-body").children[0]!.children.length, 12);
  assert.equal(
    get("#calendar-day-body").children[0]!.children[0]!.className,
    "calendar-days day",
  );
  views[0]!.fire("click");
  assert.equal(
    get("#calendar-body").children[0]!.children[0]!.className,
    "calendar-days day",
  );
  views[1]!.fire("click");
  field("kind").value = "leave";
  field("kind").fire("change");
  assert.equal(get("#calendar-times").hidden, true);
  assert.equal(get("#calendar-leave").hidden, false);
  field("title").value = "Keep this draft";
  field("leaveTypeId").value = annual;
  field("quantity").value = "0.5";
  form.fire("submit");
  assert.equal(requests.at(-1)?.type, "calendar.save");
  onMessage({ data: { type: "calendar.error", message: "Save failed" } });
  assert.equal(field("title").value, "Keep this draft");
  assert.equal(get("#calendar-status").textContent, "Save failed");
  const state = {
    year,
    leaveTypes: [
      { id: annual, name: "Annual", unit: "days", count: 20, color: "amber" },
    ],
    entries: [
      {
        id: "a",
        kind: "leave",
        title: "Edited leave",
        startDate: date,
        endDate: date,
        startTime: "",
        endTime: "",
        leaveTypeId: annual,
        quantity: 2,
        color: "blue",
      },
    ],
  };
  onMessage({ data: { type: "calendar.state", state } });
  assert.equal(
    get("#calendar-totals").children[0]?.textContent,
    "Annual · 2 days used · 18 days remaining / 20",
  );
  assert.equal(
    get("#calendar-agenda-list").children[0]?.dataset.color,
    "amber",
  );
  onMessage({
    data: { type: "calendar.state", state: { ...state, entries: [] } },
  });
  assert.equal(
    get("#calendar-totals").children[0]?.textContent,
    "Annual · 0 days used · 20 days remaining / 20",
  );
});
