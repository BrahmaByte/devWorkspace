import { randomUUID } from "node:crypto";
import {
  calendarDate,
  calendarId,
  type CalendarEntry,
  type JsonCalendarSource,
} from "../../domain/calendar";

interface Store {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): Thenable<void>;
}
interface SavedSource extends Omit<JsonCalendarSource, "error"> {
  readonly uri: string;
}
const key = "calendar.jsonSources";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const clipped = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const dateTime = (value: unknown): Date | undefined => {
  const text = clipped(value, 80);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,7})?)?(?:Z|[+-]\d\d:\d\d)$/u.test(
      text,
    )
  )
    return;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : undefined;
};
const eventDate = (value: unknown, zoned: unknown): Date | undefined => {
  if (zoned !== undefined) return dateTime(zoned);
  const event = object(value);
  const raw = clipped(event.dateTime, 80);
  if (event.timeZone === "UTC") return dateTime(raw + "Z");
  return dateTime(raw);
};
const localDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const localTime = (date: Date): string =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

export function parseJsonCalendar(
  data: unknown,
  source: JsonCalendarSource,
): CalendarEntry[] {
  const rows = Array.isArray(data) ? data : object(data).value;
  const items = source.holidays
    ? Array.isArray(data)
      ? data
      : object(data).holidays
    : rows;
  if (!Array.isArray(items) || items.length > 5000)
    throw new Error("JSON calendar needs an array of up to 5,000 entries.");
  return items.map((raw, index) => {
    const item = object(raw);
    const title = clipped(source.holidays ? item.title : item.subject, 200);
    if (!title) throw new Error(`Entry ${index + 1} needs a title.`);
    let startDate: string;
    let endDate: string;
    let startTime = "";
    let endTime = "";
    if (source.holidays) {
      startDate = clipped(item.date, 10);
      endDate = startDate;
      if (!calendarDate(startDate))
        throw new Error(`Holiday ${index + 1} needs a valid YYYY-MM-DD date.`);
      const year = object(data).year;
      if (year !== undefined && year !== Number(startDate.slice(0, 4)))
        throw new Error(`Holiday ${index + 1} does not match the file year.`);
    } else {
      const start = eventDate(item.start, item.startWithTimeZone);
      const end = eventDate(item.end, item.endWithTimeZone);
      if (!start || !end || end <= start)
        throw new Error(
          `Event ${index + 1} needs valid zoned start and end times.`,
        );
      startDate = localDate(start);
      endDate = localDate(end);
      startTime = localTime(start);
      endTime = localTime(end);
      if (!calendarDate(startDate) || !calendarDate(endDate))
        throw new Error(
          `Event ${index + 1} is outside the supported calendar years.`,
        );
    }
    return {
      id: `${source.id}:${index}`,
      kind: source.holidays ? "holiday" : "event",
      sourceId: source.id,
      sourceName: source.name,
      title,
      startDate,
      endDate,
      startTime,
      endTime,
      agenda: clipped(
        source.holidays ? item.description : item.bodyPreview,
        5000,
      ),
      color: source.color,
      leaveTypeId: "",
      quantity: 0,
    };
  });
}

export class JsonCalendarService {
  private readonly cache = new Map<string, CalendarEntry[]>();
  private readonly links = new Map<string, string>();
  private readonly errors = new Map<string, string>();
  public constructor(
    private readonly store: Store,
    private readonly read: (uri: string) => Promise<Uint8Array>,
  ) {}
  private saved(): SavedSource[] {
    const value: unknown = this.store.get(key, []);
    return Array.isArray(value)
      ? (value as unknown[]).filter((item): item is SavedSource => {
          const source = object(item);
          return (
            calendarId(source.id) &&
            typeof source.name === "string" &&
            !!source.name.trim() &&
            source.name.length <= 100 &&
            typeof source.color === "string" &&
            /^#[a-f0-9]{6}$/iu.test(source.color) &&
            source.format === "json" &&
            typeof source.holidays === "boolean" &&
            typeof source.uri === "string" &&
            source.uri.startsWith("file:") &&
            source.uri.length <= 4000
          );
        })
      : [];
  }
  public sources(): JsonCalendarSource[] {
    return this.saved().map((source) => ({
      id: source.id,
      name: source.name,
      color: source.color,
      holidays: source.holidays,
      format: "json",
      error: this.errors.get(source.id),
    }));
  }
  public entries(year: number): CalendarEntry[] {
    return [...this.cache.values()]
      .flat()
      .filter(
        (entry) =>
          entry.startDate <= `${year}-12-31` &&
          entry.endDate >= `${year}-01-01`,
      );
  }
  public event(id: string): CalendarEntry | undefined {
    return [...this.cache.values()].flat().find((entry) => entry.id === id);
  }
  public link(id: string): string | undefined {
    return this.event(id) ? this.links.get(id) : undefined;
  }
  private async load(source: SavedSource): Promise<void> {
    const bytes = await this.read(source.uri);
    if (bytes.byteLength > 2_000_000)
      throw new Error("JSON calendar must be at most 2 MB.");
    let data: unknown;
    try {
      data = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as unknown;
    } catch {
      throw new Error("Choose a valid UTF-8 JSON calendar file.");
    }
    const entries = parseJsonCalendar(data, source);
    const rows = Array.isArray(data) ? data : object(data).value;
    for (const entry of this.cache.get(source.id) ?? [])
      this.links.delete(entry.id);
    if (!source.holidays && Array.isArray(rows))
      rows.forEach((raw, index) => {
        const item = object(raw);
        const value = object(item.onlineMeeting).joinUrl ?? item.webLink;
        if (typeof value !== "string" || value.length > 2000) return;
        try {
          const url = new URL(value);
          if (url.protocol === "https:" && !url.username && !url.password)
            this.links.set(`${source.id}:${index}`, url.toString());
        } catch {
          // Ignore invalid external links while keeping the calendar event.
        }
      });
    this.cache.set(source.id, entries);
    this.errors.delete(source.id);
  }
  public async loadSaved(): Promise<void> {
    for (const source of this.saved()) {
      try {
        await this.load(source);
      } catch {
        this.errors.set(
          source.id,
          "File unavailable or invalid. Refresh this source.",
        );
      }
    }
  }
  public async add(
    uri: string,
    name: string,
    color: `#${string}`,
    holidays: boolean,
  ): Promise<void> {
    const sources = this.saved();
    if (sources.length >= 5)
      throw new Error(
        "Remove a JSON calendar before adding another (five-source limit).",
      );
    if (sources.some((source) => source.uri === uri))
      throw new Error("This JSON file is already connected.");
    if (
      !uri.startsWith("file:") ||
      uri.length > 4000 ||
      !name.trim() ||
      name.length > 100 ||
      !/^#[a-f0-9]{6}$/iu.test(color)
    )
      throw new Error("Invalid JSON calendar settings.");
    const source: SavedSource = {
      id: randomUUID(),
      name: name.trim(),
      color,
      holidays,
      format: "json",
      uri,
    };
    await this.load(source);
    await this.store.update(key, [...sources, source]);
  }
  public async refresh(id: string): Promise<void> {
    const source = this.saved().find((item) => item.id === id);
    if (!source) throw new Error("JSON calendar not found.");
    try {
      await this.load(source);
    } catch (error) {
      this.errors.set(id, "File unavailable or invalid. Refresh this source.");
      throw error;
    }
  }
  public async remove(id: string): Promise<void> {
    const sources = this.saved();
    if (!sources.some((source) => source.id === id))
      throw new Error("JSON calendar not found.");
    await this.store.update(
      key,
      sources.filter((source) => source.id !== id),
    );
    for (const entry of this.cache.get(id) ?? []) this.links.delete(entry.id);
    this.cache.delete(id);
    this.errors.delete(id);
  }
}
