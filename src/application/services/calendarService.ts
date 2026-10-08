import { randomUUID } from "node:crypto";
import {
  calendarId,
  calendarDayCount,
  calendarYear,
  validCalendarInput,
  validLeaveType,
  type CalendarInput,
  type CalendarState,
  type LeaveType,
} from "../../domain/calendar";
import type { CalendarRepository } from "../../infrastructure/database/calendarRepository";

export class CalendarService {
  public constructor(private readonly repository: CalendarRepository) {}
  public getState(year: number): CalendarState {
    if (!calendarYear(year))
      throw new Error("Choose a year between 1900 and 2100.");
    return this.repository.getState(year);
  }
  public async save(input: CalendarInput): Promise<void> {
    if (!validCalendarInput(input))
      throw new Error(
        "Check dates, times and leave quantity. Plans need an end time after their start; split leave across calendar years.",
      );
    if (input.id && !this.repository.exists(input.id))
      throw new Error("This calendar entry no longer exists.");
    if (!input.id && this.repository.count() >= 5000)
      throw new Error(
        "Calendar limit reached (5,000 entries). Remove old entries first.",
      );
    let quantity = input.quantity;
    if (input.kind === "leave") {
      const type = this.repository
        .getState(Number(input.startDate.slice(0, 4)))
        .leaveTypes.find((type) => type.id === input.leaveTypeId);
      if (!type) throw new Error("Choose an existing leave type.");
      if (type.unit === "days") {
        const days = calendarDayCount(input.startDate, input.endDate);
        if (quantity === 0.5 && days !== 1)
          throw new Error("Half-day leave requires a single date.");
        quantity = quantity === 0.5 ? 0.5 : days;
      }
    }
    await this.repository.save({
      ...input,
      quantity,
      id: input.id || randomUUID(),
      title: input.title.trim(),
    });
  }
  public async delete(id: string): Promise<void> {
    if (!calendarId(id) || !this.repository.exists(id))
      throw new Error("Calendar entry not found.");
    await this.repository.delete(id);
  }
  public async saveType(
    input: Omit<LeaveType, "id"> & { id?: string },
  ): Promise<void> {
    if (!validLeaveType(input))
      throw new Error(
        "Enter a leave type name, days or hours, a valid annual count and a color.",
      );
    const types = this.repository.getState(new Date().getFullYear()).leaveTypes;
    const existing = types.find((type) => type.id === input.id);
    if (
      !["days", "hours"].includes(input.unit) &&
      input.unit !== existing?.unit
    )
      throw new Error("Choose days or hours for new leave types.");
    if (input.id && !existing) throw new Error("Leave type not found.");
    if (!input.id && types.length >= 50)
      throw new Error("Leave type limit reached (50).");
    if (
      types.some(
        (type) =>
          type.id !== input.id &&
          type.name.toLowerCase() === input.name.trim().toLowerCase(),
      )
    )
      throw new Error("That leave type already exists.");
    if (
      existing &&
      existing.unit !== input.unit.trim() &&
      this.repository.usedType(existing.id)
    )
      throw new Error(
        "This unit is used by saved leave. Create a new type to use another unit.",
      );
    await this.repository.saveType({
      id: input.id || randomUUID(),
      name: input.name.trim(),
      unit: input.unit.trim(),
      count: input.count,
      color: input.color,
    });
  }
  public async deleteType(id: string): Promise<void> {
    if (!calendarId(id)) throw new Error("Leave type not found.");
    if (this.repository.usedType(id))
      throw new Error(
        "This type is used by saved leave. Update or remove those entries first.",
      );
    await this.repository.deleteType(id);
  }
}
