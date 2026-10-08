import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
    await service.saveType({ name: "Annual", unit: "days" });
    await service.saveType({ name: "Appointment", unit: "hours" });
    const types = service.getState(2026).leaveTypes;
    const annual = types.find((type) => type.name === "Annual")!;
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
      service.saveType({ name: "annual", unit: "days" }),
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

void it("rejects invalid calendar messages at the trust boundary", () => {
  const request = (entry: unknown) =>
    parseWebviewRequest({ type: "calendar.save", year: 2026, entry });
  assert.equal(request(plan).ok, true);
  for (const entry of [
    { ...plan, startDate: "2026-02-30" },
    { ...plan, endTime: "08:00" },
    { ...plan, endTime: "24:00" },
    { ...plan, title: " " },
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
  for (const view of ["day", "week", "year"])
    assert.match(html, new RegExp('data-calendar-view="' + view + '"', "u"));
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(html)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
  assert.equal(
    parseWebviewRequest({ type: "navigation.select", page: "calendar" }).ok,
    true,
  );
});
