import { shellPages, type ShellPage, type WebviewRequest } from "./messages";
import { noteLimits } from "../../application/services/noteService";
import { stickyColors, type StickyColor } from "../../domain/notes/models";
import {
  preferredIdes,
  type PreferredIde,
} from "../../domain/workspace/models";
import { workspaceLimits } from "../../application/services/workspaceService";

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

function isOptionalString(
  value: unknown,
  maximum: number,
): value is string | undefined {
  return value === undefined || isString(value, maximum);
}
function isPreferredIde(value: unknown): value is PreferredIde | undefined {
  return (
    value === undefined ||
    (typeof value === "string" &&
      (preferredIdes as readonly string[]).includes(value))
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
  if (
    value.type === "workspace.refresh" ||
    value.type === "projects.browse" ||
    value.type === "commands.browse"
  )
    return hasOnlyKeys(value, ["type"])
      ? { ok: true, value: { type: value.type } }
      : { ok: false, error: `${value.type} is invalid.` };
  if (value.type === "projects.create" || value.type === "projects.update") {
    const update = value.type === "projects.update";
    if (
      !hasOnlyKeys(value, [
        "type",
        "id",
        "name",
        "localPath",
        "preferredIde",
      ]) ||
      (update && !isId(value.id)) ||
      !isString(value.name, workspaceLimits.name) ||
      !isString(value.localPath, workspaceLimits.path) ||
      !isPreferredIde(value.preferredIde)
    )
      return { ok: false, error: `${value.type} is invalid.` };
    return {
      ok: true,
      value: {
        type: value.type,
        ...(update ? { id: value.id as string } : {}),
        name: value.name,
        localPath: value.localPath,
        ...(value.preferredIde ? { preferredIde: value.preferredIde } : {}),
      } as WebviewRequest,
    };
  }
  if (
    [
      "projects.delete",
      "projects.terminal",
      "commands.delete",
      "commands.execute",
      "environments.delete",
    ].includes(value.type)
  ) {
    if (!hasOnlyKeys(value, ["type", "id"]) || !isId(value.id))
      return { ok: false, error: `${value.type} is invalid.` };
    return {
      ok: true,
      value: { type: value.type, id: value.id } as WebviewRequest,
    };
  }
  if (value.type === "projects.favourite") {
    return hasOnlyKeys(value, ["type", "id", "favourite"]) &&
      isId(value.id) &&
      typeof value.favourite === "boolean"
      ? {
          ok: true,
          value: {
            type: "projects.favourite",
            id: value.id,
            favourite: value.favourite,
          },
        }
      : { ok: false, error: "projects.favourite is invalid." };
  }
  if (value.type === "commands.create") {
    if (
      !hasOnlyKeys(value, ["type", "name", "command", "workingDirectory"]) ||
      !isString(value.name, workspaceLimits.name) ||
      !isString(value.command, workspaceLimits.command) ||
      /[\r\n\0]/u.test(value.command) ||
      !isOptionalString(value.workingDirectory, workspaceLimits.path)
    )
      return { ok: false, error: "commands.create is invalid." };
    return {
      ok: true,
      value: {
        type: "commands.create",
        name: value.name,
        command: value.command,
        ...(value.workingDirectory
          ? { workingDirectory: value.workingDirectory }
          : {}),
      },
    };
  }
  if (value.type === "environments.create") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "projectId",
        "name",
        "description",
        "variableNames",
      ]) ||
      (value.projectId !== undefined && !isId(value.projectId)) ||
      !isString(value.name, workspaceLimits.name) ||
      !isString(value.description, workspaceLimits.description) ||
      !Array.isArray(value.variableNames) ||
      value.variableNames.length > 100 ||
      !value.variableNames.every((item) =>
        isString(item, workspaceLimits.variableName),
      )
    )
      return { ok: false, error: "environments.create is invalid." };
    return {
      ok: true,
      value: {
        type: "environments.create",
        ...(value.projectId ? { projectId: value.projectId } : {}),
        name: value.name,
        description: value.description,
        variableNames: value.variableNames,
      },
    };
  }
  return { ok: false, error: "Unknown message type." };
}
