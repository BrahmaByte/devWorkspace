import { randomUUID } from "node:crypto";
import {
  TeamCalendarError,
  calendarColor,
  calendarId,
  calendarYear,
  teamCalendarUrl,
  type CalendarEntry,
  type TeamCalendarSource,
} from "../../domain/calendar";
import type { CalendarRepository } from "../../infrastructure/database/calendarRepository";
import { loadTeamCalendar } from "../../infrastructure/confluence/teamCalendarParser";
import type { ConfluenceService } from "./confluenceService";
import type { SecretStore } from "./jiraService";

const secretKey = (id: string) => `devworkspace.calendar.${id}.subscription`;
export class TeamCalendarService {
  private readonly cache = new Map<
    string,
    { year: number; entries: readonly CalendarEntry[] }
  >();
  private generation = 0;
  private busy = false;
  // ponytail: one bounded feed at a time; per-source concurrency only if needed.
  public constructor(
    private readonly repository: CalendarRepository,
    private readonly secrets: SecretStore,
    private readonly confluence: ConfluenceService,
  ) {}
  public sources(): readonly TeamCalendarSource[] {
    return this.repository.listSources().map((source) => ({
      ...source,
      loadedYear: this.cache.get(source.id)?.year,
    }));
  }
  public entries(year: number): readonly CalendarEntry[] {
    return [...this.cache.values()]
      .filter((item) => item.year === year)
      .flatMap((item) => item.entries);
  }
  public clear(): void {
    this.generation++;
    this.cache.clear();
  }
  public async connect(
    name: string,
    url: string,
    color: `#${string}`,
    holidays: boolean,
    year: number,
  ): Promise<void> {
    if (this.busy)
      throw new TeamCalendarError(
        "A calendar is already loading. Wait before refreshing.",
      );
    this.busy = true;
    try {
      if (
        !name.trim() ||
        name.length > 100 ||
        !calendarColor(color) ||
        !color.startsWith("#") ||
        typeof holidays !== "boolean" ||
        !calendarYear(year)
      )
        throw new TeamCalendarError("Invalid calendar settings.");
      if (this.sources().length >= 5)
        throw new TeamCalendarError(
          "Remove a calendar before adding another (five-calendar limit).",
        );
      const site = this.confluence.calendarSite();
      const trusted = teamCalendarUrl(site, url);
      for (const existing of this.sources()) {
        if ((await this.secrets.get(secretKey(existing.id))) === trusted)
          throw new TeamCalendarError("This calendar is already connected.");
      }
      const source: TeamCalendarSource = {
        id: randomUUID(),
        name: name.trim(),
        origin: new URL(site).origin,
        color,
        holidays,
      };
      const generation = this.generation;
      await this.secrets.store(secretKey(source.id), trusted);
      try {
        await this.load(source, trusted, year);
        if (generation !== this.generation)
          throw new TeamCalendarError(
            "Connection changed. Add the calendar again.",
          );
        await this.repository.saveSource(source);
      } catch (error) {
        this.cache.delete(source.id);
        await this.secrets.delete(secretKey(source.id));
        throw error;
      }
    } finally {
      this.busy = false;
    }
  }
  private async load(
    source: TeamCalendarSource,
    url: string,
    year: number,
  ): Promise<void> {
    const generation = this.generation;
    const feed = await this.confluence.readCalendarFeed(url);
    const entries = await loadTeamCalendar(feed, source, year);
    if (generation !== this.generation)
      throw new TeamCalendarError("Connection changed. Refresh again.");
    this.cache.set(source.id, { year, entries });
  }
  public async refresh(id: string, year: number): Promise<void> {
    if (this.busy)
      throw new TeamCalendarError(
        "A calendar is already loading. Wait before refreshing.",
      );
    this.busy = true;
    try {
      if (!calendarId(id) || !calendarYear(year))
        throw new TeamCalendarError("Invalid calendar request.");
      const source = this.sources().find((item) => item.id === id);
      if (!source) throw new TeamCalendarError("Calendar not found.");
      if (source.origin !== new URL(this.confluence.calendarSite()).origin)
        throw new TeamCalendarError(
          "Reconnect the calendar's original Confluence site in Settings.",
        );
      const url = await this.secrets.get(secretKey(id));
      if (!url)
        throw new TeamCalendarError(
          "Calendar subscription is unavailable. Remove it and connect again.",
        );
      await this.load(source, url, year);
    } finally {
      this.busy = false;
    }
  }
  public async remove(id: string): Promise<void> {
    if (!calendarId(id) || !this.sources().some((source) => source.id === id))
      throw new TeamCalendarError("Calendar not found.");
    this.generation++;
    await this.repository.deleteSource(id);
    await this.secrets.delete(secretKey(id));
    this.cache.delete(id);
  }
}
