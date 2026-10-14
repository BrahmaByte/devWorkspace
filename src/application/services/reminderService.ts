import { randomUUID } from "node:crypto";

import type { Reminder } from "../../domain/home/reminders";
import type { ReminderRepository } from "../../infrastructure/database/reminderRepository";

export const reminderLimits = { title: 120 } as const;
type Timer = ReturnType<typeof setTimeout>;

export class ReminderService {
  private readonly timers = new Map<string, Timer>();

  public constructor(
    private readonly repository: ReminderRepository,
    private readonly notify: (title: string) => PromiseLike<unknown>,
    private readonly now: () => Date = () => new Date(),
    private readonly schedule: (
      action: () => void | Promise<void>,
      delay: number,
    ) => Timer = setTimeout,
    private readonly cancel: (timer: Timer) => void = clearTimeout,
  ) {}

  public start(): void {
    for (const reminder of this.repository.list()) this.arm(reminder);
  }

  public list(): readonly Reminder[] {
    return this.repository.list();
  }

  public async create(title: string, time: string): Promise<void> {
    const cleanTitle = title.trim();
    if (
      !cleanTitle ||
      cleanTitle.length > reminderLimits.title ||
      /[\0\r\n]/u.test(cleanTitle)
    )
      throw new Error("Reminder title is invalid.");
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time))
      throw new Error("Reminder time is invalid.");
    const now = this.now();
    const hours = Number(time.slice(0, 2));
    const minutes = Number(time.slice(3));
    const scheduled = new Date(now);
    scheduled.setHours(hours, minutes, 0, 0);
    if (scheduled.getTime() <= now.getTime())
      throw new Error("Choose a future time today.");
    const reminder: Reminder = {
      id: randomUUID(),
      title: cleanTitle,
      scheduledAt: scheduled.toISOString(),
      createdAt: now.toISOString(),
    };
    await this.repository.save(reminder);
    this.arm(reminder);
  }

  public async delete(id: string): Promise<void> {
    const timer = this.timers.get(id);
    if (timer) this.cancel(timer);
    this.timers.delete(id);
    await this.repository.delete(id);
  }

  public dispose(): void {
    for (const timer of this.timers.values()) this.cancel(timer);
    this.timers.clear();
  }

  private arm(reminder: Reminder): void {
    const delay = Math.max(
      0,
      Date.parse(reminder.scheduledAt) - this.now().getTime(),
    );
    this.timers.set(
      reminder.id,
      this.schedule(() => this.fire(reminder), delay),
    );
  }

  private async fire(reminder: Reminder): Promise<void> {
    this.timers.delete(reminder.id);
    await this.repository.delete(reminder.id);
    await this.notify(reminder.title);
  }
}
