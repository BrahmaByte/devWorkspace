export type AtlassianCredential =
  | { readonly type: "bearer"; readonly token: string }
  | {
      readonly type: "basic";
      readonly email: string;
      readonly token: string;
    };

export function isAtlassianCloud(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  return hostname === "atlassian.net" || hostname.endsWith(".atlassian.net");
}

export function createAtlassianCredential(
  baseUrl: string,
  token: string,
  email?: string,
): AtlassianCredential {
  if (!token.trim()) throw new Error("An Atlassian credential is required.");
  if (!isAtlassianCloud(baseUrl)) return { type: "bearer", token };
  const normalizedEmail = email?.trim();
  if (
    !normalizedEmail ||
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedEmail)
  )
    throw new Error("A valid Atlassian account email is required.");
  return { type: "basic", email: normalizedEmail, token };
}

export function serializeCredential(credential: AtlassianCredential): string {
  return JSON.stringify(credential);
}

export function deserializeCredential(value: string): AtlassianCredential {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      "token" in parsed &&
      typeof parsed.token === "string"
    ) {
      if (parsed.type === "bearer")
        return { type: "bearer", token: parsed.token };
      if (
        parsed.type === "basic" &&
        "email" in parsed &&
        typeof parsed.email === "string"
      )
        return { type: "basic", email: parsed.email, token: parsed.token };
    }
  } catch {
    // Legacy values stored only the Data Center PAT.
  }
  return { type: "bearer", token: value };
}

export function authorizationHeader(credential: AtlassianCredential): string {
  return credential.type === "bearer"
    ? `Bearer ${credential.token}`
    : `Basic ${Buffer.from(`${credential.email}:${credential.token}`, "utf8").toString("base64")}`;
}
