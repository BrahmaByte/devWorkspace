import { shellPages, type ShellPage, type WebviewRequest } from "./messages";
import { noteLimits } from "../../application/services/noteService";
import { stickyColors, type StickyColor } from "../../domain/notes/models";

export type ParseResult =
  | { readonly ok: true; readonly value: WebviewRequest }
  | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isShellPage(value: unknown): value is ShellPage {
  return (
    typeof value === "string" &&
    (shellPages as readonly string[]).includes(value)
  );
}

function isString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/iu.test(value);
}

function isStickyColor(value: unknown): value is StickyColor {
  return (
    typeof value === "string" &&
    (stickyColors as readonly string[]).includes(value)
  );
}

export function parseWebviewRequest(value: unknown): ParseResult {
  if (!isRecord(value) || typeof value.type !== "string") {
    return { ok: false, error: "Message must be an object with a type." };
  }
  if (value.type === "shell.ready") {
    return hasOnlyKeys(value, ["type"])
      ? { ok: true, value: { type: "shell.ready" } }
      : { ok: false, error: "shell.ready contains unknown fields." };
  }
  if (value.type === "navigation.select") {
    if (!hasOnlyKeys(value, ["type", "page"]) || !isShellPage(value.page)) {
      return { ok: false, error: "navigation.select has an invalid page." };
    }
    return { ok: true, value: { type: "navigation.select", page: value.page } };
  }
  if (value.type === "notes.refresh") {
    return hasOnlyKeys(value, ["type", "query"]) &&
      isString(value.query, noteLimits.search)
      ? { ok: true, value: { type: "notes.refresh", query: value.query } }
      : { ok: false, error: "notes.refresh is invalid." };
  }
  if (value.type === "notes.create" || value.type === "notes.update") {
    const isUpdate = value.type === "notes.update";
    const keys = isUpdate
      ? ["type", "id", "title", "content"]
      : ["type", "title", "content"];
    if (
      !hasOnlyKeys(value, keys) ||
      (isUpdate && !isId(value.id)) ||
      !isString(value.title, noteLimits.title) ||
      !isString(value.content, noteLimits.content)
    )
      return { ok: false, error: `${value.type} is invalid.` };
    return isUpdate
      ? {
          ok: true,
          value: {
            type: "notes.update",
            id: value.id as string,
            title: value.title,
            content: value.content,
          },
        }
      : {
          ok: true,
          value: {
            type: "notes.create",
            title: value.title,
            content: value.content,
          },
        };
  }
  if (value.type === "notes.pin" || value.type === "notes.archive") {
    const field = value.type === "notes.pin" ? "pinned" : "archived";
    if (
      !hasOnlyKeys(value, ["type", "id", field]) ||
      !isId(value.id) ||
      typeof value[field] !== "boolean"
    )
      return { ok: false, error: `${value.type} is invalid.` };
    return value.type === "notes.pin"
      ? {
          ok: true,
          value: {
            type: "notes.pin",
            id: value.id,
            pinned: value.pinned as boolean,
          },
        }
      : {
          ok: true,
          value: {
            type: "notes.archive",
            id: value.id,
            archived: value.archived as boolean,
          },
        };
  }
  if (value.type === "notes.delete" || value.type === "sticky.delete") {
    return hasOnlyKeys(value, ["type", "id"]) && isId(value.id)
      ? { ok: true, value: { type: value.type, id: value.id } }
      : { ok: false, error: `${value.type} is invalid.` };
  }
  if (value.type === "sticky.create" || value.type === "sticky.update") {
    const isUpdate = value.type === "sticky.update";
    const keys = isUpdate
      ? ["type", "id", "content", "color", "sortOrder"]
      : ["type", "content", "color", "sortOrder"];
    if (
      !hasOnlyKeys(value, keys) ||
      (isUpdate && !isId(value.id)) ||
      !isString(value.content, noteLimits.stickyContent) ||
      !isStickyColor(value.color) ||
      !Number.isSafeInteger(value.sortOrder) ||
      (value.sortOrder as number) < 0 ||
      (value.sortOrder as number) > 10_000
    )
      return { ok: false, error: `${value.type} is invalid.` };
    return isUpdate
      ? {
          ok: true,
          value: {
            type: "sticky.update",
            id: value.id as string,
            content: value.content,
            color: value.color,
            sortOrder: value.sortOrder as number,
          },
        }
      : {
          ok: true,
          value: {
            type: "sticky.create",
            content: value.content,
            color: value.color,
            sortOrder: value.sortOrder as number,
          },
        };
  }
  return { ok: false, error: "Unknown message type." };
}
