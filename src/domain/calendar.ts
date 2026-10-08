export interface LeaveType {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly count: number | null;
  readonly color: CalendarEntry["color"];
}
export interface CalendarEntry {
  readonly id: string;
  readonly kind: "plan" | "holiday" | "leave" | "event";
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly includeWeekends?: boolean;
  readonly title: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly agenda: string;
  readonly color: "blue" | "teal" | "amber" | "pink" | `#${string}`;
  readonly leaveTypeId: string;
  readonly quantity: number;
}
export type CalendarInput = Omit<
  CalendarEntry,
  "id" | "kind" | "sourceId" | "sourceName"
> & {
  readonly kind: "plan" | "holiday" | "leave";
  readonly id?: string;
};
export interface CalendarState {
  readonly year: number;
  readonly entries: readonly CalendarEntry[];
  readonly leaveTypes: readonly LeaveType[];
  readonly sources?: readonly TeamCalendarSource[];
}
export interface TeamCalendarSource {
  readonly id: string;
  readonly name: string;
  readonly origin: string;
  readonly color: `#${string}`;
  readonly holidays: boolean;
  readonly loadedYear?: number;
}
export class TeamCalendarError extends Error {}
export function teamCalendarUrl(baseUrl: string, value: string): string {
  if (value.length > 4000)
    throw new TeamCalendarError("Calendar subscription URL is too long.");
  let url: URL;
  try {
    url = new URL(value.replace(/^webcal:/iu, "https:"));
  } catch {
    throw new TeamCalendarError("Enter a valid iCal subscription URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== new URL(baseUrl).origin ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/(?:[A-Za-z0-9_.~-]+\/)*rest\/calendar-services\/1\.0\/calendar\/export\/subcalendar\/(?:private\/)?[A-Za-z0-9_-]{1,200}\.ics$/u.test(
      url.pathname,
    )
  )
    throw new TeamCalendarError(
      "Use the Team Calendar Subscribe → iCal URL from the connected Confluence site, not a page or CalDAV URL.",
    );
  return url.toString();
}
/** Date-only calculation: holiday overlaps count once; weekends use UTC weekdays. */
export function calendarLeaveCount(
  start: string,
  end: string,
  includeWeekends: boolean,
  holidays: readonly CalendarEntry[],
): number {
  if (!calendarDate(start) || !calendarDate(end) || end < start) return 0;
  let count = 0;
  for (
    const date = new Date(start + "T00:00:00Z");
    date.toISOString().slice(0, 10) <= end;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    const key = date.toISOString().slice(0, 10);
    if (
      (!includeWeekends && [0, 6].includes(date.getUTCDay())) ||
      holidays.some(
        (holiday) =>
          holiday.kind === "holiday" &&
          holiday.startDate <= key &&
          holiday.endDate >= key,
      )
    )
      continue;
    count++;
  }
  return count;
}
export const calendarId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9-]{36}$/iu.test(value);
export const calendarYear = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1900 && Number(value) <= 2100;
export const calendarColor = (
  value: unknown,
): value is CalendarEntry["color"] =>
  typeof value === "string" &&
  (/^#[a-f0-9]{6}$/iu.test(value) ||
    ["blue", "teal", "amber", "pink"].includes(value));
export function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const date = new Date(value + "T12:00:00Z");
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    calendarYear(date.getUTCFullYear())
  );
}
/** Inclusive date-only span, independent of local DST transitions. */
export const calendarDayCount = (startDate: string, endDate: string): number =>
  (Date.parse(endDate + "T00:00:00Z") - Date.parse(startDate + "T00:00:00Z")) /
    86_400_000 +
  1;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length <= max &&
  // Control characters are deliberately rejected at the message boundary.
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
export function validLeaveType(
  value: unknown,
): value is Omit<LeaveType, "id"> & { id?: string } {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(
      Object.getPrototypeOf(value) as object | null,
    )
  )
    return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).every((key) =>
      ["id", "name", "unit", "count", "color"].includes(key),
    ) &&
    (v.id === undefined || calendarId(v.id)) &&
    text(v.name, 80) &&
    !!v.name.trim() &&
    text(v.unit, 24) &&
    !!v.unit.trim() &&
    (v.count === null ||
      (typeof v.count === "number" &&
        Number.isFinite(v.count) &&
        v.count >= 0 &&
        v.count <= 10000)) &&
    calendarColor(v.color)
  );
}
export function validCalendarInput(value: unknown): value is CalendarInput {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(
      Object.getPrototypeOf(value) as object | null,
    )
  )
    return false;
  const v = value as Record<string, unknown>;
  if (
    !Object.keys(v).every((key) =>
      [
        "id",
        "kind",
        "title",
        "startDate",
        "endDate",
        "startTime",
        "endTime",
        "agenda",
        "color",
        "leaveTypeId",
        "quantity",
        "includeWeekends",
      ].includes(key),
    )
  )
    return false;
  if (v.id !== undefined && !calendarId(v.id)) return false;
  if (v.includeWeekends !== undefined && typeof v.includeWeekends !== "boolean")
    return false;
  if (
    !text(v.title, 200) ||
    !v.title.trim() ||
    !text(v.agenda, 5000) ||
    !calendarDate(v.startDate) ||
    !calendarDate(v.endDate) ||
    v.endDate < v.startDate ||
    !calendarColor(v.color)
  )
    return false;
  if (v.kind === "plan")
    return (
      v.startDate === v.endDate &&
      typeof v.startTime === "string" &&
      typeof v.endTime === "string" &&
      /^([01]\d|2[0-3]):[0-5]\d$/u.test(v.startTime) &&
      /^([01]\d|2[0-3]):[0-5]\d$/u.test(v.endTime) &&
      v.endTime > v.startTime &&
      v.leaveTypeId === "" &&
      v.quantity === 0
    );
  if (v.startTime !== "" || v.endTime !== "") return false;
  if (v.kind === "holiday") return v.leaveTypeId === "" && v.quantity === 0;
  return (
    v.kind === "leave" &&
    v.startDate.slice(0, 4) === v.endDate.slice(0, 4) &&
    calendarId(v.leaveTypeId) &&
    typeof v.quantity === "number" &&
    Number.isFinite(v.quantity) &&
    v.quantity > 0 &&
    v.quantity <= 10000
  );
}
