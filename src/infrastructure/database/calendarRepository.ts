import type {
  CalendarEntry,
  CalendarState,
  LeaveType,
  TeamCalendarSource,
} from "../../domain/calendar";
import type { LocalDatabase } from "./localDatabase";

export class CalendarRepository {
  public listSources(): readonly TeamCalendarSource[] {
    return this.database
      .query("SELECT * FROM team_calendar_sources ORDER BY name;")
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        origin: String(row.origin),
        color: String(row.color) as `#${string}`,
        holidays: row.holidays === 1,
      }));
  }
  public async saveSource(source: TeamCalendarSource): Promise<void> {
    this.database.run(
      "INSERT INTO team_calendar_sources(id,name,origin,color,holidays) VALUES(?,?,?,?,?);",
      [
        source.id,
        source.name,
        source.origin,
        source.color,
        source.holidays ? 1 : 0,
      ],
    );
    await this.database.persist();
  }
  public async deleteSource(id: string): Promise<void> {
    this.database.run("DELETE FROM team_calendar_sources WHERE id=?;", [id]);
    await this.database.persist();
  }
  public constructor(private readonly database: LocalDatabase) {}
  public getState(year: number): CalendarState {
    const entries = this.database
      .query(
        "SELECT data FROM calendar_entries WHERE start_date <= ? AND end_date >= ? ORDER BY start_date, id;",
        [`${year}-12-31`, `${year}-01-01`],
      )
      .map((row) => JSON.parse(String(row.data)) as CalendarEntry);
    const leaveTypes = this.database
      .query(
        "SELECT id,name,unit,allowance,color,custom_color FROM calendar_leave_types ORDER BY name;",
      )
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        unit: String(row.unit),
        count: row.allowance === null ? null : Number(row.allowance),
        color: String(row.custom_color ?? row.color) as LeaveType["color"],
      }));
    return { year, entries, leaveTypes };
  }
  public exists(id: string): boolean {
    return !!this.database.getScalar(
      "SELECT id FROM calendar_entries WHERE id=?;",
      [id],
    );
  }
  public usedType(id: string): boolean {
    return !!this.database.getScalar(
      "SELECT id FROM calendar_entries WHERE leave_type_id=? LIMIT 1;",
      [id],
    );
  }
  public count(): number {
    return Number(
      this.database.getScalar("SELECT COUNT(*) FROM calendar_entries;"),
    );
  }
  public listOverlapping(
    startDate: string,
    endDate: string,
  ): readonly CalendarEntry[] {
    return this.database
      .query(
        "SELECT data FROM calendar_entries WHERE start_date <= ? AND end_date >= ? ORDER BY start_date, id;",
        [endDate, startDate],
      )
      .map((row) => JSON.parse(String(row.data)) as CalendarEntry);
  }
  public listByLeaveType(id: string): readonly CalendarEntry[] {
    return this.database
      .query(
        "SELECT data FROM calendar_entries WHERE leave_type_id=? ORDER BY start_date, id;",
        [id],
      )
      .map((row) => JSON.parse(String(row.data)) as CalendarEntry);
  }
  public async save(entry: CalendarEntry): Promise<void> {
    this.database.run(
      "INSERT INTO calendar_entries(id,start_date,end_date,leave_type_id,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET start_date=excluded.start_date,end_date=excluded.end_date,leave_type_id=excluded.leave_type_id,data=excluded.data;",
      [
        entry.id,
        entry.startDate,
        entry.endDate,
        entry.leaveTypeId || null,
        JSON.stringify(entry),
      ],
    );
    await this.database.persist();
  }
  public async delete(id: string): Promise<void> {
    this.database.run("DELETE FROM calendar_entries WHERE id=?;", [id]);
    await this.database.persist();
  }
  public async saveType(type: LeaveType): Promise<void> {
    this.database.run(
      "INSERT INTO calendar_leave_types(id,name,unit,allowance,color,custom_color) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,unit=excluded.unit,allowance=excluded.allowance,color=excluded.color,custom_color=excluded.custom_color;",
      [
        type.id,
        type.name,
        type.unit,
        type.count,
        type.color.startsWith("#") ? "blue" : type.color,
        type.color.startsWith("#") ? type.color : null,
      ],
    );
    await this.database.persist();
  }
  public async deleteType(id: string): Promise<void> {
    this.database.run("DELETE FROM calendar_leave_types WHERE id=?;", [id]);
    await this.database.persist();
  }
}
