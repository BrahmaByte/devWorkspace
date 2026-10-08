import { createHash } from "node:crypto";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";
import { sync, expandRecurringEvent, type ParameterValue } from "node-ical";
import {
  TeamCalendarError,
  calendarDate,
  calendarYear,
  type CalendarEntry,
  type TeamCalendarSource,
} from "../../domain/calendar";

const text = (value: ParameterValue | undefined, max: number): string =>
  (typeof value === "string" ? value : (value?.val ?? ""))
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/gu, "")
    .slice(0, max);
const localDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const localTime = (date: Date): string =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
function dateInZone(date: Date, zone?: string): string {
  if (!zone) return localDate(date);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
const idFor = (
  source: string,
  uid: string,
  occurrence: string,
  day: string,
) => {
  const hash = createHash("sha256")
    .update(JSON.stringify([source, uid, occurrence, day]))
    .digest("hex")
    .slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
};

/** Runs only on feed text: never fetches URLs, follows attachments or executes alarms. */
export function parseTeamCalendar(
  ics: string,
  source: TeamCalendarSource,
  year: number,
): readonly CalendarEntry[] {
  if (
    !calendarYear(year) ||
    Buffer.byteLength(ics) > 2_000_000 ||
    !/^\s*BEGIN:VCALENDAR\s*$/imu.test(ics) ||
    !/END:VCALENDAR\s*$/iu.test(ics)
  )
    throw new TeamCalendarError("Invalid calendar feed.");
  const from = new Date(year, 0, 1),
    to = new Date(year + 1, 0, 1);
  const entries = new Map<string, CalendarEntry>();
  const data = sync.parseICS(ics);
  for (const event of Object.values(data)) {
    if (event?.type !== "VEVENT" || event.status === "CANCELLED") continue;
    if (
      !event.uid ||
      event.uid.length > 1000 ||
      !(event.start instanceof Date) ||
      !Number.isFinite(event.start.getTime())
    )
      throw new TeamCalendarError("Invalid calendar event.");
    const occurrences = expandRecurringEvent(event, {
      from,
      to: new Date(to.getTime() - 1),
      expandOngoing: true,
    });
    if (occurrences.length > 2000)
      throw new TeamCalendarError(
        "Calendar exceeds the 2,000-event limit for this year.",
      );
    for (const occurrence of occurrences) {
      if (occurrence.event.status === "CANCELLED") continue;
      const { start, end } = occurrence;
      if (!Number.isFinite(end.getTime()) || end < start)
        throw new TeamCalendarError("Invalid calendar dates.");
      const title = text(occurrence.summary, 200).trim() || "Untitled event";
      const agenda = text(occurrence.event.description, 5000);
      const add = (
        startDate: string,
        endDate: string,
        startTime: string,
        endTime: string,
      ): void => {
        if (!calendarDate(startDate) || !calendarDate(endDate))
          throw new TeamCalendarError(
            "Calendar dates must be between 1900 and 2100.",
          );
        const id = idFor(source.id, event.uid, start.toISOString(), startDate);
        entries.set(id, {
          id,
          kind: source.holidays ? "holiday" : "event",
          title,
          agenda,
          startDate,
          endDate,
          startTime,
          endTime,
          color: source.color,
          leaveTypeId: "",
          quantity: 0,
          sourceId: source.id,
          sourceName: source.name,
        });
        if (entries.size > 2000)
          throw new TeamCalendarError(
            "Calendar exceeds the 2,000-event limit for this year.",
          );
      };
      if (occurrence.isFullDay || source.holidays) {
        const first = occurrence.isFullDay
          ? dateInZone(start, start.tz)
          : localDate(start);
        const exclusive = occurrence.isFullDay
          ? dateInZone(end, end.tz ?? start.tz)
          : localDate(new Date(end.getTime() - 1));
        const last =
          occurrence.isFullDay && end > start
            ? new Date(Date.parse(exclusive + "T00:00:00Z") - 86_400_000)
                .toISOString()
                .slice(0, 10)
            : exclusive;
        if (first <= `${year}-12-31` && last >= `${year}-01-01`)
          add(
            first < `${year}-01-01` ? `${year}-01-01` : first,
            last > `${year}-12-31` ? `${year}-12-31` : last,
            "",
            "",
          );
      } else {
        let cursor = new Date(Math.max(start.getTime(), from.getTime()));
        const limit = Math.min(end.getTime(), to.getTime());
        while (cursor.getTime() < limit) {
          const midnight = new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate() + 1,
          );
          const segmentEnd = new Date(Math.min(limit, midnight.getTime()));
          const key = localDate(cursor);
          add(
            key,
            key,
            localTime(cursor),
            segmentEnd.getTime() === midnight.getTime()
              ? "24:00"
              : localTime(segmentEnd),
          );
          cursor = segmentEnd;
        }
        if (start.getTime() === end.getTime() && start >= from && start < to)
          add(
            localDate(start),
            localDate(start),
            localTime(start),
            localTime(end),
          );
      }
    }
  }
  return [...entries.values()].sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      a.startTime.localeCompare(b.startTime),
  );
}

export function loadTeamCalendar(
  ics: string,
  source: TeamCalendarSource,
  year: number,
): Promise<readonly CalendarEntry[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { ics, source, year },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
      stdout: true,
      stderr: true,
    });
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(
        new TeamCalendarError(
          "Calendar parsing timed out. Use a smaller calendar.",
        ),
      );
    }, 5000);
    const stop = () => {
      clearTimeout(timeout);
      void worker.terminate();
    };
    worker.once("message", (result: { entries?: CalendarEntry[] }) => {
      stop();
      if (result.entries) resolve(result.entries);
      else
        reject(
          new TeamCalendarError(
            "Calendar could not be parsed. Check its dates, time zones and recurrence rules; the limit is 2,000 events per year.",
          ),
        );
    });
    worker.once("error", () => {
      stop();
      reject(
        new TeamCalendarError(
          "Calendar could not be parsed within the safety limits.",
        ),
      );
    });
    worker.once("exit", () => {
      clearTimeout(timeout);
      reject(
        new TeamCalendarError(
          "Calendar parser stopped. Last loaded events were retained.",
        ),
      );
    });
  });
}
if (!isMainThread) {
  const input = workerData as {
    ics: string;
    source: TeamCalendarSource;
    year: number;
  };
  try {
    parentPort?.postMessage({
      entries: parseTeamCalendar(input.ics, input.source, input.year),
    });
  } catch {
    parentPort?.postMessage({});
  }
}
