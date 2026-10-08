export interface LeaveType {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
}
export interface CalendarEntry {
  readonly id: string;
  readonly kind: "plan" | "holiday" | "leave";
  readonly title: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly agenda: string;
  readonly color: "blue" | "teal" | "amber" | "pink";
  readonly leaveTypeId: string;
  readonly quantity: number;
}
export type CalendarInput = Omit<CalendarEntry, "id"> & {
  readonly id?: string;
};
export interface CalendarState {
  readonly year: number;
  readonly entries: readonly CalendarEntry[];
  readonly leaveTypes: readonly LeaveType[];
}
export const calendarId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9-]{36}$/iu.test(value);
export const calendarYear = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1900 && Number(value) <= 2100;
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
    Object.keys(v).every((key) => ["id", "name", "unit"].includes(key)) &&
    (v.id === undefined || calendarId(v.id)) &&
    text(v.name, 80) &&
    !!v.name.trim() &&
    text(v.unit, 24) &&
    !!v.unit.trim()
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
      ].includes(key),
    )
  )
    return false;
  if (v.id !== undefined && !calendarId(v.id)) return false;
  if (
    !text(v.title, 200) ||
    !v.title.trim() ||
    !text(v.agenda, 5000) ||
    !calendarDate(v.startDate) ||
    !calendarDate(v.endDate) ||
    v.endDate < v.startDate ||
    !["blue", "teal", "amber", "pink"].includes(String(v.color))
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
