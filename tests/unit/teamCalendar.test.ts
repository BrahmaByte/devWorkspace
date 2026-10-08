import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseTeamCalendar,
  loadTeamCalendar,
} from "../../src/infrastructure/confluence/teamCalendarParser";
import {
  teamCalendarUrl,
  type TeamCalendarSource,
} from "../../src/domain/calendar";
import { TeamCalendarService } from "../../src/application/services/teamCalendarService";
import type { ConfluenceService } from "../../src/application/services/confluenceService";
import { CalendarService } from "../../src/application/services/calendarService";
import { CalendarRepository } from "../../src/infrastructure/database/calendarRepository";
import { LocalDatabase } from "../../src/infrastructure/database/localDatabase";
import { parseWebviewRequest } from "../../src/webview/protocol/validation";
import {
  FetchConfluenceClient,
  ConfluenceRequestError,
} from "../../src/infrastructure/confluence/fetchConfluenceClient";
import {
  VscodeHttpTransport,
  UnsafeNetworkRedirectError,
} from "../../src/infrastructure/http/vscodeHttpTransport";

const source: TeamCalendarSource = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Team",
  origin: "https://wiki.example.test",
  color: "#129988",
  holidays: false,
};
const url =
  source.origin +
  "/wiki/rest/calendar-services/1.0/calendar/export/subcalendar/private/fake-subscription.ics";
const feed = (...events: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...events.map((event) => "BEGIN:VEVENT\r\n" + event + "\r\nEND:VEVENT"),
    "END:VCALENDAR",
  ].join("\r\n");
const holiday =
  "UID:holiday\r\nDTSTART;VALUE=DATE:20261009\r\nDTEND;VALUE=DATE:20261011\r\nSUMMARY:Holiday";

void it("uses the managed transport, rejects login pages and bounds streamed feeds without redirecting credentials", async () => {
  const credential = { type: "bearer", token: "fake-pat" } as const;
  const client = (response: Response) =>
    new FetchConfluenceClient(
      source.origin,
      credential,
      new VscodeHttpTransport((_input, init) => {
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer fake-pat",
        );
        return Promise.resolve(response);
      }),
    );
  assert.equal(
    await client(new Response(feed(holiday))).readCalendarFeed(url),
    feed(holiday),
  );
  await assert.rejects(
    client(new Response("Login")).readCalendarFeed(url),
    /did not return an iCalendar/u,
  );
  await assert.rejects(
    client(new Response(null, { status: 401 })).readCalendarFeed(url),
    ConfluenceRequestError,
  );
  await assert.rejects(
    client(
      new Response("x", { headers: { "content-length": "2000001" } }),
    ).readCalendarFeed(url),
    /2 MB/u,
  );
  await assert.rejects(
    client(new Response("x".repeat(2_000_001))).readCalendarFeed(url),
    /2 MB/u,
  );
  await assert.rejects(
    client(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example.test/feed" },
      }),
    ).readCalendarFeed(url),
    UnsafeNetworkRedirectError,
  );
});

void it("retains all-day year boundaries and uses named time zones across daylight saving changes", () => {
  const entries = parseTeamCalendar(
    feed(
      "UID:boundary\r\nDTSTART;VALUE=DATE:20251231\r\nDTEND;VALUE=DATE:20260103\r\nSUMMARY:Boundary",
      "UID:dst\r\nDTSTART;TZID=America/New_York:20260307T090000\r\nDTEND;TZID=America/New_York:20260307T100000\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:DST",
    ),
    source,
    2026,
  );
  assert.equal(entries[0]?.startDate, "2026-01-01");
  assert.equal(entries[0]?.endDate, "2026-01-02");
  const times = entries
    .filter((entry) => entry.title === "DST")
    .map((entry) => entry.startTime);
  const expected = [7, 8, 9].map((day) =>
    new Date(Date.UTC(2026, 2, day, day === 7 ? 14 : 13)).toLocaleTimeString(
      "en-GB",
      { hour: "2-digit", minute: "2-digit" },
    ),
  );
  assert.deepEqual(times, expected);
});

void it("accepts only same-site HTTPS Team Calendar iCal feeds and no URLs from Webview", () => {
  assert.equal(teamCalendarUrl(source.origin, url), url);
  assert.equal(
    teamCalendarUrl(source.origin, url.replace("https:", "webcal:")),
    url,
  );
  for (const unsafe of [
    url.replace("https:", "http:"),
    url.replace("wiki.example.test", "evil.example.test"),
    url.replace("https://", "https://user:fake@"),
    url + "#fragment",
    source.origin + "/rest/api/content",
    source.origin + "/caldav",
    url.replace(".ics", ".json"),
  ])
    assert.throws(() => teamCalendarUrl(source.origin, unsafe));
  const connect = {
    type: "calendar.source.connect",
    year: 2026,
    name: "Team",
    color: "#129988",
    holidays: false,
  };
  assert.equal(parseWebviewRequest(connect).ok, true);
  for (const extra of [
    { url },
    { token: "fake" },
    { color: "red" },
    { holidays: "true" },
    { year: 2101 },
  ])
    assert.equal(parseWebviewRequest({ ...connect, ...extra }).ok, false);
  assert.equal(
    parseWebviewRequest({
      type: "calendar.source.refresh",
      year: 2026,
      id: source.id,
    }).ok,
    true,
  );
  assert.equal(
    parseWebviewRequest({
      type: "calendar.source.event",
      year: 2026,
      id: "../../path",
    }).ok,
    false,
  );
});

void it("parses inclusive all-day dates, recurrence exclusions/overrides and cancellation without loading attachments", async () => {
  const ics = feed(
    holiday,
    "UID:recurring\r\nDTSTART:20261001T090000\r\nDTEND:20261001T100000\r\nRRULE:FREQ=DAILY;COUNT=4\r\nEXDATE:20261002T090000\r\nSUMMARY:Standup",
    "UID:recurring\r\nRECURRENCE-ID:20261003T090000\r\nDTSTART:20261003T110000\r\nDTEND:20261003T120000\r\nSUMMARY:Moved",
    "UID:cancelled\r\nDTSTART:20261008T090000\r\nDTEND:20261008T100000\r\nSTATUS:CANCELLED\r\nSUMMARY:Cancelled",
    "UID:night\r\nDTSTART:20261008T230000\r\nDTEND:20261009T010000\r\nSUMMARY:Night\r\nATTACH:https://evil.example.test/not-fetched",
  );
  const entries = await loadTeamCalendar(ics, source, 2026);
  assert.equal(entries.length, 6);
  const allDay = entries.find((entry) => entry.title === "Holiday")!;
  assert.equal(allDay.startDate, "2026-10-09");
  assert.equal(allDay.endDate, "2026-10-10");
  assert.equal(entries.filter((entry) => entry.title === "Standup").length, 2);
  assert.equal(
    entries.find((entry) => entry.title === "Moved")?.startTime,
    "11:00",
  );
  assert.deepEqual(
    entries
      .filter((entry) => entry.title === "Night")
      .map((entry) => [entry.startTime, entry.endTime]),
    [
      ["23:00", "24:00"],
      ["00:00", "01:00"],
    ],
  );
  assert.deepEqual(entries, parseTeamCalendar(ics, source, 2026));
  assert.equal(parseTeamCalendar(ics, source, 2025).length, 0);
  await assert.rejects(
    loadTeamCalendar("<html>fake login</html>", source, 2026),
    /could not be parsed/u,
  );
  assert.throws(
    () => parseTeamCalendar("x".repeat(2_000_001), source, 2026),
    /Invalid calendar feed/u,
  );
  assert.throws(
    () =>
      parseTeamCalendar(
        feed(
          "UID:dense\r\nDTSTART:20260101T090000\r\nDTEND:20260101T100000\r\nRRULE:FREQ=HOURLY;COUNT=2001\r\nSUMMARY:Busy",
        ),
        source,
        2026,
      ),
    /2,000-event limit/u,
  );
});

void it("persists only subscription metadata, refreshes atomically, retains failed refreshes and counts imported holidays", async () => {
  const directory = await mkdtemp(join(tmpdir(), "team-calendar-test-"));
  const path = join(directory, "workspace.sqlite"),
    database = await LocalDatabase.open(path);
  const secrets = new Map<string, string>();
  let ics = feed(holiday),
    fail = false,
    site = source.origin;
  let waiting: Promise<string> | undefined;
  const confluence = {
    calendarSite: () => site,
    readCalendarFeed: () =>
      waiting ??
      (fail ? Promise.reject(new Error("offline")) : Promise.resolve(ics)),
  } as unknown as ConfluenceService;
  const store = {
    get: (key: string) => Promise.resolve(secrets.get(key)),
    store: (key: string, value: string) => {
      secrets.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      secrets.delete(key);
      return Promise.resolve();
    },
  };
  const repository = new CalendarRepository(database),
    team = new TeamCalendarService(repository, store, confluence);
  try {
    await team.connect("Holidays", url, "#129988", true, 2026);
    const id = team.sources()[0]!.id;
    assert.equal(team.entries(2026).length, 1);
    assert.equal(team.entries(2026)[0]?.kind, "holiday");
    await assert.rejects(
      team.connect("Duplicate", url, "#129988", false, 2026),
      /already connected/u,
    );
    const contents = await readFile(path);
    assert.equal(contents.includes(Buffer.from("fake-subscription")), false);
    assert.equal(contents.includes(Buffer.from("UID:holiday")), false);
    const calendar = new CalendarService(
      repository,
      (year) => team.entries(year),
      () => team.sources(),
    );
    await calendar.saveType({
      name: "Annual",
      unit: "days",
      count: 20,
      color: "blue",
    });
    await assert.rejects(
      calendar.save({
        kind: "leave",
        title: "Leave",
        startDate: "2026-10-08",
        endDate: "2026-10-12",
        startTime: "",
        endTime: "",
        agenda: "",
        color: "blue",
        leaveTypeId: calendar.getState(2026).leaveTypes[0]!.id,
        quantity: 999,
        includeWeekends: false,
      }),
      /cannot overlap/u,
    );
    await assert.rejects(calendar.save(team.entries(2026)[0]!), /Check dates/u);
    fail = true;
    await assert.rejects(team.refresh(id, 2026), /offline/u);
    assert.equal(team.entries(2026).length, 1);
    fail = false;
    ics = feed();
    await team.refresh(id, 2026);
    assert.equal(team.entries(2026).length, 0);
    site = "https://other.example.test";
    await assert.rejects(team.refresh(id, 2026), /original Confluence/u);
    site = source.origin;
    const restarted = new TeamCalendarService(repository, store, confluence);
    assert.equal(restarted.sources().length, 1);
    assert.equal(restarted.entries(2026).length, 0);
    let finish!: (feed: string) => void;
    waiting = new Promise((resolve) => {
      finish = resolve;
    });
    const pendingRefresh = team.refresh(id, 2026);
    await assert.rejects(team.refresh(id, 2026), /already loading/u);
    team.clear();
    finish(feed(holiday));
    await assert.rejects(pendingRefresh, /Connection changed/u);
    assert.equal(team.entries(2026).length, 0);
    waiting = undefined;
    await team.remove(id);
    assert.equal(secrets.size, 0);
    assert.equal(team.sources().length, 0);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
