import assert from "node:assert/strict";
import { it } from "node:test";
import { CalendarService } from "../../src/application/services/calendarService";
import {
  calendarDayCount,
  type CalendarEntry,
  type CalendarInput,
} from "../../src/domain/calendar";
import type { CalendarRepository } from "../../src/infrastructure/database/calendarRepository";

const dayType = "00000000-0000-4000-8000-000000000001";
const hourType = "00000000-0000-4000-8000-000000000002";
const leave: CalendarInput = {
  kind: "leave",
  title: "Leave",
  startDate: "2026-10-08",
  endDate: "2026-10-08",
  startTime: "",
  endTime: "",
  agenda: "",
  color: "blue",
  leaveTypeId: dayType,
  quantity: 1,
};
function fixture() {
  const entries = new Map<string, CalendarEntry>();
  const repository = {
    exists: (id: string) => entries.has(id),
    count: () => entries.size,
    getState: (year: number) => ({
      year,
      entries: [...entries.values()],
      leaveTypes: [
        { id: dayType, name: "Annual", unit: "days", count: 20, color: "blue" },
        {
          id: hourType,
          name: "Appointment",
          unit: "hours",
          count: 8,
          color: "pink",
        },
      ],
    }),
    save: (entry: CalendarEntry) => {
      entries.set(entry.id, entry);
      return Promise.resolve();
    },
  };
  return {
    service: new CalendarService(repository as unknown as CalendarRepository),
    entries,
  };
}
for (const [name, startDate, endDate, expected] of [
  ["single day", "2026-10-08", "2026-10-08", 1],
  ["inclusive range", "2026-10-08", "2026-10-10", 3],
  ["weekend is included", "2026-10-10", "2026-10-12", 3],
  ["month boundary", "2026-01-31", "2026-02-02", 3],
  ["leap day", "2024-02-28", "2024-03-01", 3],
  ["non-leap century", "1900-02-28", "1900-03-01", 2],
  ["upper supported century", "2100-02-28", "2100-03-01", 2],
  ["DST spring boundary", "2026-03-07", "2026-03-09", 3],
  ["DST autumn boundary", "2026-10-31", "2026-11-02", 3],
  ["full normal year", "2026-01-01", "2026-12-31", 365],
  ["full leap year", "2024-01-01", "2024-12-31", 366],
] as const) {
  void it("derives leave from selected dates: " + name, async () => {
    const { service, entries } = fixture();
    assert.equal(calendarDayCount(startDate, endDate), expected);
    await service.save({ ...leave, startDate, endDate, quantity: 999 });
    assert.equal([...entries.values()][0]?.quantity, expected);
  });
}
void it("supports one half-day, rejects multi-date half-days and preserves legacy hours", async () => {
  const { service, entries } = fixture();
  await service.save({ ...leave, quantity: 0.5 });
  assert.equal([...entries.values()][0]?.quantity, 0.5);
  await assert.rejects(
    service.save({ ...leave, endDate: "2026-10-09", quantity: 0.5 }),
    /single date/u,
  );
  await service.save({
    ...leave,
    leaveTypeId: hourType,
    endDate: "2026-10-10",
    quantity: 2.25,
  });
  assert.equal([...entries.values()][1]?.quantity, 2.25);
  const original = [...entries.values()][0]!;
  await service.save({ ...original, endDate: "2026-10-10", quantity: 1 });
  assert.equal(entries.get(original.id)?.quantity, 3);
  assert.equal(entries.size, 2);
});
void it("rejects invalid dates, ranges, amounts and untrusted fields without writes", async () => {
  const { service, entries } = fixture();
  for (const changes of [
    { startDate: "2026-02-30" },
    { startDate: "2026-2-01" },
    { endDate: "2026-10-07" },
    { endDate: "2027-01-01" },
    { startDate: "1899-12-31" },
    { endDate: "2101-01-01" },
    { quantity: 0 },
    { quantity: -1 },
    { quantity: NaN },
    { quantity: Infinity },
    { quantity: 10001 },
    { quantity: "3" },
    { quantity: undefined },
    { leaveTypeId: "00000000-0000-4000-8000-000000000099" },
    { title: " " },
    { color: "url(https://untrusted.invalid)" },
    { halfDay: true },
    { startTime: "09:00" },
    { endTime: "10:00" },
    { id: "00000000-0000-4000-8000-000000000099" },
  ])
    await assert.rejects(
      service.save({ ...leave, ...changes } as CalendarInput),
    );
  assert.equal(entries.size, 0);
});
