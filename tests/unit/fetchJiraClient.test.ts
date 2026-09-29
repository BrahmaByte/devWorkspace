import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  FetchJiraClient,
  JiraRequestError,
} from "../../src/infrastructure/jira/fetchJiraClient";

const originalFetch = globalThis.fetch;

void afterEach(() => {
  globalThis.fetch = originalFetch;
});

void describe("Jira REST provider", () => {
  void it("uses bearer authentication and maps supported responses", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
      const path =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requests.push({ url: path, init });
      const body = path.endsWith("/myself")
        ? { accountId: "u1", displayName: "User" }
        : path.includes("/search")
          ? { issues: [issueJson()] }
          : {
              ...issueJson(),
              fields: { ...issueJson().fields, description: "Details" },
            };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200 }),
      );
    };

    const client = new FetchJiraClient(
      "https://jira.example.test",
      "fake-token",
    );
    assert.equal((await client.getCurrentUser()).displayName, "User");
    assert.equal((await client.getAssignedIssues())[0]?.key, "DEV-1");
    assert.equal((await client.getIssue("DEV-1")).description, "Details");
    assert.equal(
      requests[0]?.url,
      "https://jira.example.test/rest/api/2/myself",
    );
    assert.equal(
      new Headers(requests[0]?.init?.headers).get("authorization"),
      "Bearer fake-token",
    );
    assert.match(String(requests[2]?.url), /issue\/DEV-1/u);
  });

  void it("maps authentication failures without exposing response bodies", async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response("sensitive server response", { status: 401 }),
      );
    const client = new FetchJiraClient(
      "https://jira.example.test",
      "fake-token",
    );
    await assert.rejects(client.getCurrentUser(), (error: unknown) => {
      assert.ok(error instanceof JiraRequestError);
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /sensitive/u);
      return true;
    });
  });
});

function issueJson() {
  return {
    id: "1",
    key: "DEV-1",
    fields: {
      summary: "Test",
      status: { name: "Open" },
      updated: "2026-09-29T00:00:00Z",
    },
  };
}
