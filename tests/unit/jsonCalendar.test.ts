import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import {
  JsonCalendarService,
  parseJsonCalendar,
} from "../../src/application/services/jsonCalendarService";
import { parseWebviewRequest } from "../../src/webview/protocol/validation";
import type { JsonCalendarSource } from "../../src/domain/calendar";

const source: JsonCalendarSource = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Meetings",
  color: "#3278e6",
  holidays: false,
  format: "json",
};
const meeting = {
  subject: "Planning call",
  start: { dateTime: "2026-10-12T10:00:00", timeZone: "UTC" },
  end: { dateTime: "2026-10-12T11:00:00", timeZone: "UTC" },
  bodyPreview: "Agenda",
  webLink: "https://outlook.office.com/calendar/item/fake",
  organizer: { emailAddress: { name: "Meeting owner" } },
  attendees: [
    { emailAddress: { name: "First attendee" } },
    { emailAddress: { address: "second@example.test" } },
  ],
  location: { displayName: "Microsoft Teams" },
};

void it("imports bounded Outlook JSON events and yearly holidays in local time", () => {
  const [entry] = parseJsonCalendar({ value: [meeting] }, source);
  assert.equal(entry?.title, "Planning call");
  assert.equal(entry?.sourceId, source.id);
  const expected = new Date("2026-10-12T10:00:00Z");
  assert.equal(
    entry?.startTime,
    `${String(expected.getHours()).padStart(2, "0")}:${String(expected.getMinutes()).padStart(2, "0")}`,
  );
  assert.equal(entry?.agenda, "Agenda");
  assert.equal(entry?.organizer, "Meeting owner");
  assert.deepEqual(entry?.attendees, ["First attendee", "second@example.test"]);
  assert.equal(entry?.platform, "Microsoft Teams");
  const [connectorEntry] = parseJsonCalendar(
    {
      value: [
        {
          ...meeting,
          organizer: "owner@example.test",
          attendees: undefined,
          requiredAttendees:
            "first@example.test; second@example.test, THIRD@example.test",
          optionalAttendees: "third@example.test",
        },
      ],
    },
    source,
  );
  assert.equal(connectorEntry?.organizer, "owner@example.test");
  assert.deepEqual(connectorEntry?.attendees, [
    "first@example.test",
    "second@example.test",
    "THIRD@example.test",
  ]);
  assert.equal(
    parseJsonCalendar(
      {
        value: [{ ...meeting, startWithTimeZone: "2026-10-12T10:00:00+00:00" }],
      },
      source,
    )[0]?.startTime,
    entry?.startTime,
  );
  const holidays = parseJsonCalendar(
    { year: 2026, holidays: [{ date: "2026-12-25", title: "Winter holiday" }] },
    { ...source, holidays: true },
  );
  assert.equal(holidays[0]?.kind, "holiday");
  assert.equal(holidays[0]?.startDate, "2026-12-25");
  assert.throws(
    () =>
      parseJsonCalendar(
        {
          value: [
            {
              ...meeting,
              start: { dateTime: "2026-10-12T10:00:00", timeZone: "Unknown" },
            },
          ],
        },
        source,
      ),
    /zoned/u,
  );
  assert.throws(
    () =>
      parseJsonCalendar(
        { holidays: [{ date: "2026-02-30", title: "Invalid" }] },
        { ...source, holidays: true },
      ),
    /valid YYYY/u,
  );
  assert.throws(
    () =>
      parseJsonCalendar(
        { year: 2025, holidays: [{ date: "2026-12-25", title: "Wrong year" }] },
        { ...source, holidays: true },
      ),
    /file year/u,
  );
  assert.throws(
    () => parseJsonCalendar({ value: Array(5001).fill(meeting) }, source),
    /5,000/u,
  );
});

void it("deduplicates periodic saved-calendar reloads and disposes the dashboard timer", async () => {
  const saved = new Map<string, unknown>([
    [
      "calendar.jsonSources",
      [
        {
          ...source,
          uri: "file:///calendar.json",
        },
      ],
    ],
  ]);
  let reads = 0;
  let finish!: (value: Uint8Array) => void;
  const service = new JsonCalendarService(
    {
      get<T>(key: string, fallback: T): T {
        return (saved.get(key) as T) ?? fallback;
      },
      update: () => Promise.resolve(),
    },
    () => {
      reads++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  const first = service.loadSaved();
  const second = service.loadSaved();
  assert.equal(first, second);
  assert.equal(reads, 1);
  finish(Buffer.from(JSON.stringify([meeting])));
  await first;
  const extension = readFileSync("src/extension/extension.ts", "utf8");
  assert.match(extension, /5 \* 60_000/u);
  assert.match(extension, /clearInterval\(calendarRefreshTimer\)/u);
});

void it("persists only picked file metadata, refreshes atomically and keeps links in the host", async () => {
  const state = new Map<string, unknown>();
  const store = {
    get<T>(key: string, fallback: T): T {
      return (state.get(key) as T) ?? fallback;
    },
    update(key: string, value: unknown): Thenable<void> {
      state.set(key, value);
      return Promise.resolve();
    },
  };
  let file = JSON.stringify([meeting]);
  const service = new JsonCalendarService(store, () =>
    Promise.resolve(Buffer.from(file)),
  );
  await service.add("file:///calendar.json", "Calendar", "#3278e6", false);
  const [entry] = service.entries(2026);
  assert.equal(service.sources()[0]?.name, "Calendar");
  assert.equal("uri" in service.sources()[0]!, false);
  assert.equal(service.link(entry!.id), meeting.webLink);
  assert.equal(service.meetingLink(entry!.id), undefined);
  file = JSON.stringify([
    {
      ...meeting,
      onlineMeetingUrl:
        "https://teams.microsoft.com/l/meetup-join/encoded-meeting",
    },
  ]);
  await service.refresh(entry!.sourceId!);
  assert.equal(
    service.meetingLink(entry!.id),
    "https://teams.microsoft.com/l/meetup-join/encoded-meeting",
  );
  file = JSON.stringify([
    {
      ...meeting,
      onlineMeeting: { joinUrl: "https://company.zoom.us/j/123456789" },
    },
  ]);
  await service.refresh(entry!.sourceId!);
  assert.equal(
    service.meetingLink(entry!.id),
    "https://company.zoom.us/j/123456789",
  );
  file = JSON.stringify([
    {
      ...meeting,
      body: '<a href="https://teams.microsoft.com/l/meetup-join/body?id=1&amp;token=2">Join</a>',
    },
  ]);
  await service.refresh(entry!.sourceId!);
  assert.equal(
    service.meetingLink(entry!.id),
    "https://teams.microsoft.com/l/meetup-join/body?id=1&token=2",
  );
  file = JSON.stringify([
    { ...meeting, onlineMeetingUrl: "https://teams.microsoft.com.evil.test/j" },
  ]);
  await service.refresh(entry!.sourceId!);
  assert.equal(service.meetingLink(entry!.id), undefined);
  assert.equal(service.link(entry!.id), meeting.webLink);
  const reopened = new JsonCalendarService(store, () =>
    Promise.resolve(Buffer.from(file)),
  );
  await reopened.loadSaved();
  assert.equal(reopened.entries(2026)[0]?.title, "Planning call");
  file = JSON.stringify([meeting]) + " ".repeat(2_100_000);
  await reopened.refresh(entry!.sourceId!);
  assert.equal(reopened.entries(2026)[0]?.title, "Planning call");
  file = " ".repeat(20_000_001);
  await assert.rejects(reopened.refresh(entry!.sourceId!), /20 MB/u);
  file = "invalid";
  await assert.rejects(reopened.refresh(entry!.sourceId!), /valid UTF-8 JSON/u);
  assert.equal(reopened.entries(2026)[0]?.title, "Planning call");
  assert.ok(reopened.sources()[0]?.error);
  await reopened.remove(entry!.sourceId!);
  assert.equal(reopened.entries(2026).length, 0);
  assert.equal(reopened.link(entry!.id), undefined);
  assert.equal(reopened.meetingLink(entry!.id), undefined);
});

void it("rejects imported holidays that overlap leave or another holiday without replacing loaded entries", async () => {
  const saved = new Map<string, unknown>();
  const store = {
    get<T>(key: string, fallback: T): T {
      return (saved.get(key) as T) ?? fallback;
    },
    update(key: string, value: unknown): Thenable<void> {
      saved.set(key, value);
      return Promise.resolve();
    },
  };
  const files = new Map<string, string>([
    [
      "file:///one.json",
      JSON.stringify({
        year: 2026,
        holidays: [{ date: "2026-12-25", title: "First" }],
      }),
    ],
    [
      "file:///two.json",
      JSON.stringify({
        year: 2026,
        holidays: [{ date: "2026-12-26", title: "Second" }],
      }),
    ],
  ]);
  const leave = {
    ...parseJsonCalendar(
      { year: 2026, holidays: [{ date: "2026-12-27", title: "Leave" }] },
      { ...source, holidays: true },
    )[0]!,
    kind: "leave" as const,
  };
  const service = new JsonCalendarService(
    store,
    (uri) => Promise.resolve(Buffer.from(files.get(uri)!)),
    (start, end) =>
      leave.startDate <= end && leave.endDate >= start ? [leave] : [],
  );
  await service.add("file:///one.json", "First", "#3278e6", true);
  await service.add("file:///two.json", "Second", "#3278e6", true);
  const firstId = service.sources()[0]!.id;
  files.set(
    "file:///one.json",
    JSON.stringify({
      year: 2026,
      holidays: [{ date: "2026-12-26", title: "Conflict" }],
    }),
  );
  await assert.rejects(service.refresh(firstId), /overlaps/u);
  assert.equal(
    service.entries(2026).find((entry) => entry.sourceId === firstId)?.title,
    "First",
  );
  files.set(
    "file:///one.json",
    JSON.stringify({
      year: 2026,
      holidays: [{ date: "2026-12-27", title: "Conflict" }],
    }),
  );
  await assert.rejects(service.refresh(firstId), /overlaps/u);
  files.set(
    "file:///one.json",
    JSON.stringify({
      year: 2026,
      holidays: [
        { date: "2026-12-28", title: "One" },
        { date: "2026-12-28", title: "Duplicate" },
      ],
    }),
  );
  await assert.rejects(service.refresh(firstId), /overlaps/u);
});

void it("accepts only bounded JSON source actions without Webview paths or links", () => {
  assert.equal(
    parseWebviewRequest({
      type: "calendar.json.add",
      year: 2026,
      holidays: false,
      color: "#3278e6",
    }).ok,
    true,
  );
  assert.equal(
    parseWebviewRequest({
      type: "calendar.json.add",
      year: 2026,
      holidays: false,
      color: "#3278e6",
      path: "/private/file",
    }).ok,
    false,
  );
  assert.equal(
    parseWebviewRequest({
      type: "calendar.json.open",
      year: 2026,
      id: source.id + ":0",
    }).ok,
    true,
  );
  assert.equal(
    parseWebviewRequest({
      type: "calendar.json.open",
      year: 2026,
      id: "https://evil.test",
    }).ok,
    false,
  );
  for (const type of [
    "calendar.source.connect",
    "calendar.source.refresh",
    "calendar.source.remove",
    "calendar.source.event",
  ])
    assert.equal(
      parseWebviewRequest({ type, year: 2026, id: source.id }).ok,
      false,
    );
});
