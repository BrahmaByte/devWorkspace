import { shellPages, type ShellPage, type WebviewRequest } from "./messages";

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
  return { ok: false, error: "Unknown message type." };
}
