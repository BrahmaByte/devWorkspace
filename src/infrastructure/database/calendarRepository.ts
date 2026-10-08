import type {
  CalendarEntry,
  CalendarState,
  LeaveType,
} from "../../domain/calendar";
import type { LocalDatabase } from "./localDatabase";

export class CalendarRepository {
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
        "SELECT id,name,unit,allowance,color FROM calendar_leave_types ORDER BY name;",
      )
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        unit: String(row.unit),
        count: row.allowance === null ? null : Number(row.allowance),
        color: String(row.color) as LeaveType["color"],
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
      "INSERT INTO calendar_leave_types(id,name,unit,allowance,color) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,unit=excluded.unit,allowance=excluded.allowance,color=excluded.color;",
      [type.id, type.name, type.unit, type.count, type.color],
    );
    await this.database.persist();
  }
  public async deleteType(id: string): Promise<void> {
    this.database.run("DELETE FROM calendar_leave_types WHERE id=?;", [id]);
    await this.database.persist();
  }
}
