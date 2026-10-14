import type { Reminder } from "../../domain/home/reminders";
import type { LocalDatabase, SqlValue } from "./localDatabase";

const text = (row: Readonly<Record<string, SqlValue>>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") throw new Error("Invalid reminder data.");
  return value;
};

export class ReminderRepository {
  public constructor(private readonly database: LocalDatabase) {}

  public list(): readonly Reminder[] {
    return this.database
      .query("SELECT * FROM reminders ORDER BY scheduled_at, created_at;")
      .map((row) => ({
        id: text(row, "id"),
        title: text(row, "title"),
        scheduledAt: text(row, "scheduled_at"),
        createdAt: text(row, "created_at"),
      }));
  }

  public async save(reminder: Reminder): Promise<void> {
    this.database.run(
      "INSERT INTO reminders(id,title,scheduled_at,created_at) VALUES(?,?,?,?);",
      [reminder.id, reminder.title, reminder.scheduledAt, reminder.createdAt],
    );
    await this.database.persist();
  }

  public async delete(id: string): Promise<void> {
    this.database.run("DELETE FROM reminders WHERE id=?;", [id]);
    await this.database.persist();
  }
}
