import { shellPages, type ShellPage, type WebviewRequest } from "./messages";
import { noteLimits } from "../../application/services/noteService";
import { stickyColors, type StickyColor } from "../../domain/notes/models";
import { workspaceLimits } from "../../application/services/workspaceService";
import { jiraLimits } from "../../application/services/jiraService";
import { confluenceLimits } from "../../application/services/confluenceService";
import { jiraBoardLimits } from "../../application/services/jiraService";
import {
  jiraBoardStatuses,
  type JiraBoardStatus,
} from "../../domain/jira/models";
import { searchLimit } from "../../application/services/searchService";
import { urlGroupLimits } from "../../application/services/urlGroupService";
import {
  searchResultTypes,
  type SearchResultType,
} from "../../domain/search/models";

export type ParseResult =
  | { readonly ok: true; readonly value: WebviewRequest }
  | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
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
function isJiraBoardStatus(value: unknown): value is JiraBoardStatus {
  return (
    typeof value === "string" &&
    (jiraBoardStatuses as readonly string[]).includes(value)
  );
}
function isSearchResultType(value: unknown): value is SearchResultType {
  return (
    typeof value === "string" &&
    (searchResultTypes as readonly string[]).includes(value)
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
  if (value.type === "walkthrough.open") {
    return hasOnlyKeys(value, ["type"])
      ? { ok: true, value: { type: "walkthrough.open" } }
      : { ok: false, error: "walkthrough.open contains unknown fields." };
  }
  if (value.type === "home.refresh") {
    return hasOnlyKeys(value, ["type"])
      ? { ok: true, value: { type: "home.refresh" } }
      : { ok: false, error: "home.refresh contains unknown fields." };
  }
  if (value.type === "home.search") {
    return hasOnlyKeys(value, ["type", "query"]) &&
      isString(value.query, noteLimits.search)
      ? { ok: true, value: { type: "home.search", query: value.query } }
      : { ok: false, error: "home.search is invalid." };
  }
  if (value.type === "urls.create") {
    return hasOnlyKeys(value, ["type", "name", "urls"]) &&
      isString(value.name, urlGroupLimits.name) &&
      Array.isArray(value.urls) &&
      value.urls.length > 0 &&
      value.urls.length <= urlGroupLimits.urls &&
      value.urls.every((url) => isString(url, urlGroupLimits.url))
      ? {
          ok: true,
          value: { type: "urls.create", name: value.name, urls: value.urls },
        }
      : { ok: false, error: "urls.create is invalid." };
  }
  if (value.type === "urls.delete" || value.type === "urls.openAll") {
    return hasOnlyKeys(value, ["type", "id"]) && isId(value.id)
      ? { ok: true, value: { type: value.type, id: value.id } }
      : { ok: false, error: `${value.type} is invalid.` };
  }
  if (value.type === "urls.open") {
    return hasOnlyKeys(value, ["type", "id", "index"]) &&
      isId(value.id) &&
      Number.isInteger(value.index) &&
      Number(value.index) >= 0 &&
      Number(value.index) < urlGroupLimits.urls
      ? {
          ok: true,
          value: {
            type: "urls.open",
            id: value.id,
            index: Number(value.index),
          },
        }
      : { ok: false, error: "urls.open is invalid." };
  }
  if (value.type === "apps.browse") {
    return hasOnlyKeys(value, ["type"])
      ? { ok: true, value: { type: "apps.browse" } }
      : { ok: false, error: "apps.browse is invalid." };
  }
  if (
    value.type === "apps.launch" ||
    value.type === "apps.close" ||
    value.type === "apps.delete"
  ) {
    return hasOnlyKeys(value, ["type", "id"]) && isId(value.id)
      ? { ok: true, value: { type: value.type, id: value.id } }
      : { ok: false, error: `${value.type} is invalid.` };
  }
  if (value.type === "search.query") {
    return hasOnlyKeys(value, ["type", "query"]) &&
      typeof value.query === "string" &&
      value.query.length <= searchLimit &&
      !/[\r\n\0]/u.test(value.query)
      ? { ok: true, value: { type: "search.query", query: value.query } }
      : { ok: false, error: "search.query is invalid." };
  }
  if (value.type === "search.open") {
    return hasOnlyKeys(value, ["type", "resultType", "id"]) &&
      isSearchResultType(value.resultType) &&
      typeof value.id === "string" &&
      value.id.length > 0 &&
      value.id.length <= 100
      ? {
          ok: true,
          value: {
            type: "search.open",
            resultType: value.resultType,
            id: value.id,
          },
        }
      : { ok: false, error: "search.open is invalid." };
  }
  if (value.type === "confluence.connect") {
    return hasOnlyKeys(value, ["type", "displayName", "baseUrl"]) &&
      isString(value.displayName, confluenceLimits.name) &&
      isString(value.baseUrl, confluenceLimits.url)
      ? {
          ok: true,
          value: {
            type: "confluence.connect",
            displayName: value.displayName,
            baseUrl: value.baseUrl,
          },
        }
      : { ok: false, error: "confluence.connect is invalid." };
  }
  if (
    value.type === "network.configure" ||
    value.type === "confluence.refresh" ||
    value.type === "confluence.disconnect"
  ) {
    return hasOnlyKeys(value, ["type"])
      ? { ok: true, value: { type: value.type } }
      : { ok: false, error: `${value.type} is invalid.` };
  }
  if (value.type === "confluence.search") {
    return hasOnlyKeys(value, ["type", "query"]) &&
      typeof value.query === "string" &&
      value.query.trim().length > 0 &&
      value.query.length <= confluenceLimits.search &&
      !/[\r\n\0]/u.test(value.query)
      ? { ok: true, value: { type: "confluence.search", query: value.query } }
      : { ok: false, error: "confluence.search is invalid." };
  }
  if (
    value.type === "confluence.open" ||
    value.type === "confluence.reader" ||
    value.type === "confluence.preview" ||
    value.type === "confluence.bookmark"
  ) {
    return hasOnlyKeys(value, ["type", "id"]) &&
      typeof value.id === "string" &&
      /^[0-9A-Za-z_-]{1,100}$/u.test(value.id)
      ? { ok: true, value: { type: value.type, id: value.id } }
      : { ok: false, error: `${value.type} is invalid.` };
  }
  if (value.type === "jira.connect") {
    return hasOnlyKeys(value, ["type", "displayName", "baseUrl"]) &&
      isString(value.displayName, jiraLimits.name) &&
      isString(value.baseUrl, jiraLimits.url)
      ? {
          ok: true,
          value: {
            type: "jira.connect",
            displayName: value.displayName,
            baseUrl: value.baseUrl,
          },
        }
      : { ok: false, error: "jira.connect is invalid." };
  }
  if (value.type === "jira.refresh" || value.type === "jira.disconnect") {
    return hasOnlyKeys(value, ["type"])
      ? { ok: true, value: { type: value.type } }
      : { ok: false, error: `${value.type} is invalid.` };
  }
  if (value.type === "jira.comments" || value.type === "jira.comment.add") {
    const key =
      typeof value.issueKey === "string" &&
      /^[A-Z][A-Z0-9_]{0,19}-[1-9][0-9]{0,9}$/u.test(value.issueKey);
    if (!key) return { ok: false, error: "Invalid issue key." };
    if (
      value.type === "jira.comments" &&
      hasOnlyKeys(value, ["type", "issueKey", "startAt"]) &&
      typeof value.startAt === "number" &&
      Number.isInteger(value.startAt) &&
      value.startAt >= 0 &&
      value.startAt <= 1_000_000
    )
      return {
        ok: true,
        value: {
          type: value.type,
          issueKey: value.issueKey as string,
          startAt: value.startAt,
        },
      };
    if (
      value.type === "jira.comment.add" &&
      hasOnlyKeys(value, ["type", "issueKey", "body"]) &&
      typeof value.body === "string" &&
      value.body.trim().length > 0 &&
      value.body.length <= 10_000 &&
      !value.body.includes("\0")
    )
      return {
        ok: true,
        value: {
          type: value.type,
          issueKey: value.issueKey as string,
          body: value.body,
        },
      };
    return { ok: false, error: "Invalid Jira comment request." };
  }
  if (value.type === "jira.issue" || value.type === "jira.open") {
    return hasOnlyKeys(value, ["type", "issueKey"]) &&
      typeof value.issueKey === "string" &&
      /^[A-Z][A-Z0-9_]{0,19}-[1-9][0-9]{0,9}$/u.test(value.issueKey)
      ? { ok: true, value: { type: value.type, issueKey: value.issueKey } }
      : { ok: false, error: `${value.type} is invalid.` };
  }
  if (value.type === "jira.search") {
    return hasOnlyKeys(value, ["type", "query"]) &&
      typeof value.query === "string" &&
      value.query.trim().length > 0 &&
      value.query.length <= jiraBoardLimits.filter &&
      !/[\r\n\0]/u.test(value.query)
      ? { ok: true, value: { type: "jira.search", query: value.query } }
      : { ok: false, error: "jira.search is invalid." };
  }
  if (value.type === "jira.local.create") {
    return hasOnlyKeys(value, ["type", "summary", "status"]) &&
      typeof value.summary === "string" &&
      value.summary.trim().length > 0 &&
      value.summary.length <= jiraBoardLimits.localSummary &&
      isJiraBoardStatus(value.status)
      ? {
          ok: true,
          value: {
            type: "jira.local.create",
            summary: value.summary,
            status: value.status,
          },
        }
      : { ok: false, error: "jira.local.create is invalid." };
  }
  if (value.type === "jira.local.move") {
    return hasOnlyKeys(value, ["type", "id", "status"]) &&
      isId(value.id) &&
      isJiraBoardStatus(value.status)
      ? {
          ok: true,
          value: {
            type: "jira.local.move",
            id: value.id,
            status: value.status,
          },
        }
      : { ok: false, error: "jira.local.move is invalid." };
  }
  if (value.type === "jira.local.delete") {
    return hasOnlyKeys(value, ["type", "id"]) && isId(value.id)
      ? { ok: true, value: { type: "jira.local.delete", id: value.id } }
      : { ok: false, error: "jira.local.delete is invalid." };
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
      !hasOnlyKeys(value, ["type", "id", "name", "localPath"]) ||
      (update && !isId(value.id)) ||
      !isString(value.name, workspaceLimits.name) ||
      !isString(value.localPath, workspaceLimits.path)
    )
      return { ok: false, error: `${value.type} is invalid.` };
    return {
      ok: true,
      value: {
        type: value.type,
        ...(update ? { id: value.id as string } : {}),
        name: value.name,
        localPath: value.localPath,
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
