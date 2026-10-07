export const walkthroughVersionKey = "onboarding.lastShownVersion";

export function walkthroughMode(
  lastShownVersion: string | undefined,
  version: string,
): "tour" | "update" | undefined {
  return !lastShownVersion
    ? "tour"
    : lastShownVersion !== version
      ? "update"
      : undefined;
}
