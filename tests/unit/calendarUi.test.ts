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
    public style: Record<
      string,
      string | ((name: string, value: string) => void)
    > = {
      setProperty: (name, value) => {
        this.style[name] = value;
      },
    };
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
      field("color").value = "#3378e6";
    },
  });
  const typeForm = get("#calendar-type-form");
  Object.assign(typeForm, {
    elements: { namedItem: (name: string) => get("type-" + name) },
    reset: () => {},
  });
  const views = ["day", "week", "month", "year"].map((view) => {
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
    get("#calendar-totals").children.map((child) =>
      child.children.map((cell) => cell.textContent),
    ),
    [
      ["Annual (days)", "20", "0.5", "19.5"],
      ["Appointment (hours)", "8", "2", "6"],
    ],
  );
  views[2]!.fire("click");
  get("#calendar-type-list").children[1]!.children[1]!.fire("click");
  assert.equal(get("type-count").step, "any");
  assert.equal(get("type-color").value, "#d65b79");
  assert.equal(get("#calendar-body").children[0]!.children.length, 49);
  views[3]!.fire("click");
  assert.equal(get("#calendar-body").children[0]!.children.length, 12);
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
  field("leaveTypeId").fire("change");
  assert.equal(field("quantity").required, false);
  assert.equal(field("quantity").disabled, true);
  assert.equal(get("#calendar-leave-quantity").hidden, true);
  field("quantity").value = "";
  for (const [start, end, expected] of [
    ["2026-10-08", "2026-10-08", 1],
    ["2026-01-31", "2026-02-02", 3],
    ["2024-02-28", "2024-03-01", 3],
    ["2026-03-07", "2026-03-09", 3],
    ["2026-10-31", "2026-11-02", 3],
  ] as const) {
    field("startDate").value = start;
    field("startDate").fire("change");
    field("endDate").value = end;
    field("endDate").fire("change");
    form.fire("submit");
    assert.equal(
      (requests.at(-1)?.entry as { quantity: number }).quantity,
      expected,
    );
    onMessage({ data: { type: "calendar.error", message: "Retain draft" } });
    assert.equal(field("quantity").disabled, true);
  }
  field("startDate").value = date;
  field("startDate").fire("change");
  // Moving the start beyond a stale end selects a single date automatically.
  field("startDate").value = "2026-12-20";
  field("startDate").fire("change");
  assert.equal(field("endDate").value, "2026-12-20");
  field("startDate").value = "2026-12-18";
  field("startDate").fire("change");
  assert.equal(field("endDate").value, "2026-12-18");
  field("endDate").value = "2026-12-22";
  field("endDate").fire("change");
  field("startDate").value = "2026-12-17";
  field("startDate").fire("change");
  assert.equal(field("endDate").value, "2026-12-22");
  field("startDate").value = "2026-12-20";
  field("startDate").fire("change");
  const beforeInvalid = requests.length;
  field("endDate").value = "2026-12-19";
  field("endDate").fire("change");
  form.fire("submit");
  assert.equal(requests.length, beforeInvalid);
  field("endDate").value = "2027-01-01";
  field("endDate").fire("change");
  form.fire("submit");
  assert.equal(requests.length, beforeInvalid);
  field("startDate").value = date;
  field("endDate").value = date;
  field("leaveTypeId").value = hourly;
  field("leaveDuration").value = "half";
  field("leaveTypeId").fire("change");
  assert.equal(field("leaveDuration").value, "full");
  assert.equal(field("quantity").required, true);
  assert.equal(field("quantity").disabled, false);
  assert.equal(get("#calendar-leave-duration").hidden, true);
  field("quantity").value = "2.25";
  form.fire("submit");
  assert.equal((requests.at(-1)?.entry as { quantity: number }).quantity, 2.25);
  onMessage({ data: { type: "calendar.error", message: "Retain draft" } });
  assert.equal(field("quantity").disabled, false);
  field("kind").value = "plan";
  field("kind").fire("change");
  assert.equal(field("quantity").required, false);
  assert.equal(field("quantity").disabled, true);
  field("kind").value = "leave";
  field("kind").fire("change");
  field("leaveTypeId").value = annual;
  field("leaveTypeId").fire("change");
  field("leaveDuration").value = "half";
  field("leaveDuration").fire("change");
  assert.equal(field("endDate").value, date);
  form.fire("submit");
  assert.equal(requests.at(-1)?.type, "calendar.save");
  assert.equal((requests.at(-1)?.entry as { quantity: number }).quantity, 0.5);
  onMessage({ data: { type: "calendar.error", message: "Save failed" } });
  assert.equal(field("title").value, "Keep this draft");
  assert.equal(get("#calendar-status").textContent, "Save failed");
  field("endDate").value = "2026-12-31";
  field("endDate").fire("change");
  assert.equal(field("leaveDuration").value, "full");
  const state = {
    year,
    leaveTypes: [
      { id: annual, name: "Annual", unit: "days", count: 20, color: "#824acb" },
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
    get("#calendar-totals").children[0]?.children[3]?.textContent,
    "18",
  );
  assert.equal(
    get("#calendar-agenda-list").children[0]?.dataset.color,
    "#824acb",
  );
  assert.equal(
    get("#calendar-agenda-list").children[0]?.style["--event-color"],
    "#824acb",
  );
  field("kind").value = "holiday";
  field("kind").fire("change");
  assert.equal(field("color").value, "#e29b30");
  onMessage({
    data: {
      type: "calendar.state",
      state: {
        ...state,
        entries: [
          ...state.entries,
          {
            ...state.entries[0],
            id: "holiday",
            kind: "holiday",
            title: "Holiday",
            color: "#e29b30",
            leaveTypeId: "",
            quantity: 0,
          },
        ],
      },
    },
  });
  const holidayButton = get("#calendar-agenda-list").children.find(
    (child) => child.dataset.kind === "holiday",
  )!;
  assert.equal(holidayButton.style["--event-color"], "#e29b30");
  views[3]!.fire("click");
  const months = get("#calendar-body").children[0]!.children;
  const markedDays = months
    .flatMap((month) => month.children[1]!.children)
    .filter((day) => day.dataset.holiday);
  assert.ok(
    markedDays.some(
      (day) =>
        day.dataset.holiday === "true" &&
        typeof day.style.background === "string" &&
        day.style.background.includes("#e29b30"),
    ),
  );
  assert.ok(
    months.some((month) =>
      month.children[2]!.children.some(
        (entry) =>
          entry.dataset.kind === "leave" &&
          entry.style["--event-color"] === "#824acb",
      ),
    ),
  );
  onMessage({
    data: { type: "calendar.state", state: { ...state, entries: [] } },
  });
  assert.equal(
    get("#calendar-totals").children[0]?.children[3]?.textContent,
    "20",
  );
});
