import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import initSqlJs from "sql.js";
import { migrations } from "../../src/infrastructure/database/migrations";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { Script } from "node:vm";
import { CalendarService } from "../../src/application/services/calendarService";
import { CalendarRepository } from "../../src/infrastructure/database/calendarRepository";
import { LocalDatabase } from "../../src/infrastructure/database/localDatabase";
import { calendarDate, type CalendarInput } from "../../src/domain/calendar";
import { parseWebviewRequest } from "../../src/webview/protocol/validation";
import { createWebviewHtml } from "../../src/webview/app/shell";

const plan: CalendarInput = {
  kind: "plan",
  title: "Review",
  startDate: "2026-10-08",
  endDate: "2026-10-08",
  startTime: "09:00",
  endTime: "10:00",
  agenda: "<script>untrusted text</script>",
  color: "blue",
  leaveTypeId: "",
  quantity: 0,
};

void it("migrates saved leave types without inventing allowances or changing legacy units", async () => {
  const directory = await mkdtemp(join(tmpdir(), "calendar-upgrade-"));
  const path = join(directory, "workspace.sqlite");
  const SQL = await initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
  });
  const legacy = new SQL.Database();
  legacy.run(
    "CREATE TABLE schema_migrations ( version INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL );",
  );
  for (const migration of migrations.slice(0, 7)) {
    legacy.run(migration.sql);
    legacy.run("INSERT INTO schema_migrations VALUES(?,?,?);", [
      migration.version,
      migration.name,
      "2026-10-08",
    ]);
  }
  const id = "00000000-0000-4000-8000-000000000099";
  legacy.run("INSERT INTO calendar_leave_types VALUES(?,?,?);", [
    id,
    "Legacy",
    "weeks",
  ]);
  await writeFile(path, legacy.export());
  legacy.close();
  const database = await LocalDatabase.open(path);
  try {
    const service = new CalendarService(new CalendarRepository(database));
    const type = service.getState(2026).leaveTypes[0]!;
    assert.deepEqual(type, {
      id,
      name: "Legacy",
      unit: "weeks",
      count: null,
      color: "blue",
    });
    await service.saveType({ ...type, count: 4, color: "pink" });
    assert.equal(service.getState(2026).leaveTypes[0]?.unit, "weeks");
    assert.equal(service.getState(2026).leaveTypes[0]?.count, 4);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void it("persists plans, inclusive holidays and fractional leave without mixing units", async () => {
  const directory = await mkdtemp(join(tmpdir(), "calendar-test-"));
  const path = join(directory, "workspace.sqlite");
  let database = await LocalDatabase.open(path);
  try {
    let service = new CalendarService(new CalendarRepository(database));
    await service.save(plan);
    await service.save({
      ...plan,
      kind: "holiday",
      title: "Holiday",
      startDate: "2026-12-31",
      endDate: "2027-01-01",
      startTime: "",
      endTime: "",
    });
    await service.saveType({
      name: "Annual",
      unit: "days",
      count: 20,
      color: "teal",
    });
    await service.saveType({
      name: "Appointment",
      unit: "hours",
      count: 8,
      color: "pink",
    });
    const types = service.getState(2026).leaveTypes;
    const annual = types.find((type) => type.name === "Annual")!;
    assert.equal(annual.count, 20);
    assert.equal(annual.color, "teal");
    await service.save({
      ...plan,
      kind: "leave",
      title: "Half day",
      startTime: "",
      endTime: "",
      leaveTypeId: annual.id,
      quantity: 0.5,
    });
    await assert.rejects(service.deleteType(annual.id), /used by saved leave/u);
    await assert.rejects(
      service.saveType({ ...annual, unit: "hours" }),
      /Create a new type/u,
    );
    await assert.rejects(
      service.saveType({
        name: "annual",
        unit: "days",
        count: 20,
        color: "blue",
      }),
      /already exists/u,
    );
    await assert.rejects(
      service.save({
        ...plan,
        kind: "leave",
        startTime: "",
        endTime: "",
        leaveTypeId: "00000000-0000-4000-8000-000000000099",
        quantity: 1,
      }),
      /existing leave type/u,
    );
    const entry = service
      .getState(2026)
      .entries.find((value) => value.kind === "plan")!;
    await service.save({ ...entry, title: "Updated review" });
    database.close();
    database = await LocalDatabase.open(path);
    service = new CalendarService(new CalendarRepository(database));
    assert.equal(service.getState(2026).entries.length, 3);
    assert.equal(service.getState(2027).entries.length, 1);
    assert.deepEqual(
      service.getState(2026).leaveTypes.find((type) => type.id === annual.id),
      annual,
    );
    await service.saveType({ ...annual, count: 15, color: "#8a41cf" });
    assert.equal(
      service.getState(2026).leaveTypes.find((type) => type.id === annual.id)
        ?.count,
      15,
    );
    assert.equal(
      service.getState(2026).leaveTypes.find((type) => type.id === annual.id)
        ?.color,
      "#8a41cf",
    );
    const holiday = service
      .getState(2026)
      .entries.find((value) => value.kind === "holiday")!;
    await service.save({ ...holiday, color: "#e29b30" });
    database.close();
    database = await LocalDatabase.open(path);
    service = new CalendarService(new CalendarRepository(database));
    assert.equal(
      service.getState(2026).leaveTypes.find((type) => type.id === annual.id)
        ?.color,
      "#8a41cf",
    );
    assert.equal(
      service.getState(2026).entries.find((value) => value.id === holiday.id)
        ?.color,
      "#e29b30",
    );
    assert.throws(() =>
      database.run(
        "UPDATE calendar_leave_types SET custom_color=? WHERE id=?;",
        ["#gggggg", annual.id],
      ),
    );
    await assert.rejects(
      service.saveType({
        name: "Invalid",
        unit: "weeks",
        count: 20,
        color: "blue",
      }),
      /days or hours/u,
    );
    assert.equal(
      service.getState(2026).entries.find((value) => value.kind === "leave")
        ?.quantity,
      0.5,
    );
    assert.equal(
      service.getState(2026).entries.find((value) => value.id === entry.id)
        ?.title,
      "Updated review",
    );
    await service.delete(entry.id);
    const leave = service
      .getState(2026)
      .entries.find((value) => value.kind === "leave")!;
    await service.delete(leave.id);
    await service.deleteType(annual.id);
    assert.equal(service.getState(2026).leaveTypes.length, 1);
    await assert.rejects(service.delete(entry.id), /not found/u);
    assert.throws(() => service.getState(2101), /Choose a year/u);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void it("persists date-derived leave and recalculates quantities after editing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "calendar-date-leave-")),
    path = join(directory, "workspace.sqlite");
  let database = await LocalDatabase.open(path);
  try {
    let service = new CalendarService(new CalendarRepository(database));
    await service.saveType({
      name: "Annual",
      unit: "days",
      count: 20,
      color: "blue",
    });
    const type = service.getState(2026).leaveTypes[0]!;
    const leave = {
      ...plan,
      kind: "leave" as const,
      startTime: "",
      endTime: "",
      leaveTypeId: type.id,
      quantity: 1,
    };
    await service.save({
      ...leave,
      title: "Three dates",
      endDate: "2026-10-10",
    });
    await service.save({ ...leave, title: "Half day", quantity: 0.5 });
    database.close();
    database = await LocalDatabase.open(path);
    service = new CalendarService(new CalendarRepository(database));
    assert.equal(
      service
        .getState(2026)
        .entries.reduce((sum, entry) => sum + entry.quantity, 0),
      3.5,
    );
    const full = service
      .getState(2026)
      .entries.find((entry) => entry.title === "Three dates")!;
    await service.save({ ...full, endDate: full.startDate });
    assert.equal(
      service
        .getState(2026)
        .entries.reduce((sum, entry) => sum + entry.quantity, 0),
      1.5,
    );
    const half = service
      .getState(2026)
      .entries.find((entry) => entry.title === "Half day")!;
    await service.delete(half.id);
    assert.equal(
      service
        .getState(2026)
        .entries.reduce((sum, entry) => sum + entry.quantity, 0),
      1,
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void it("rejects invalid calendar messages at the trust boundary", () => {
  const request = (entry: unknown) =>
    parseWebviewRequest({ type: "calendar.save", year: 2026, entry });
  assert.equal(request(plan).ok, true);
  assert.equal(request({ ...plan, color: "#12abEF" }).ok, true);
  for (const entry of [
    { ...plan, startDate: "2026-02-30" },
    { ...plan, endTime: "08:00" },
    { ...plan, endTime: "24:00" },
    { ...plan, title: " " },
    { ...plan, color: "#123" },
    { ...plan, color: "#123456; background:url(https://example.com)" },
    { ...plan, color: "#gggggg" },
    { ...plan, extra: "ignored?" },
    { ...plan, agenda: "a".repeat(5001) },
    { ...plan, kind: "leave", startTime: "", endTime: "", quantity: NaN },
    {
      ...plan,
      kind: "leave",
      startDate: "2026-12-31",
      endDate: "2027-01-01",
      startTime: "",
      endTime: "",
      quantity: 1,
      leaveTypeId: "00000000-0000-4000-8000-000000000099",
    },
  ])
    assert.equal(request(entry).ok, false);
  assert.equal(calendarDate("2024-02-29"), true);
  assert.equal(calendarDate("2025-02-29"), false);
  const leaveType = { name: "Annual", unit: "days", count: 20, color: "pink" };
  for (const value of [
    { ...leaveType, count: -1 },
    { ...leaveType, count: Infinity },
    { ...leaveType, count: 10001 },
    { ...leaveType, color: "red;script" },
    { ...leaveType, color: "#12345g" },
    { ...leaveType, remaining: 20 },
  ])
    assert.equal(
      parseWebviewRequest({
        type: "calendar.type.save",
        year: 2026,
        leaveType: value,
      }).ok,
      false,
    );
  assert.equal(
    parseWebviewRequest({
      type: "calendar.type.save",
      year: 2026,
      leaveType: { ...leaveType, count: null },
    }).ok,
    true,
  );
  assert.equal(
    parseWebviewRequest({ type: "calendar.refresh", year: 2101 }).ok,
    false,
  );
  assert.equal(
    parseWebviewRequest({
      type: "calendar.type.save",
      year: 2026,
      leaveType: { name: "Annual", unit: "days", url: "https://example.test" },
    }).ok,
    false,
  );
  assert.equal(
    parseWebviewRequest({
      type: "calendar.delete",
      year: 2026,
      id: "../../file",
    }).ok,
    false,
  );
  assert.equal(
    parseWebviewRequest({ type: "calendar.execute", year: 2026 }).ok,
    false,
  );
});

void it("renders a local calendar with a valid script and no unsafe HTML insertion", () => {
  const html = createWebviewHtml("vscode-webview://test");
  assert.match(html, /data-page="calendar"/u);
  assert.match(html, /data-view="calendar"/u);
  assert.equal((html.match(/name="color" type="color"/gu) ?? []).length, 3);
  assert.doesNotMatch(html, /select name="color"/u);
  for (const view of ["day", "week", "month", "year"])
    assert.match(html, new RegExp('data-calendar-view="' + view + '"', "u"));
  assert.doesNotMatch(html, /id="calendar-(day|year)-planner"/u);
  assert.doesNotMatch(html, /<select name="unit"/u);
  assert.match(html, /<th scope="col">Availed<\/th>/u);
  assert.match(html, /id="home-jira" class="home-list"/u);
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(html)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
  assert.equal(
    parseWebviewRequest({ type: "navigation.select", page: "calendar" }).ok,
    true,
  );
});
