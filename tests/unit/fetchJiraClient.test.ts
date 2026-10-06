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
  void it("requests and sanitizes rendered issue descriptions", async () => {
    let requestUrl = "";
    globalThis.fetch = (input) => {
      requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ...issueJson(),
            renderedFields: {
              description:
                "<h2>Plan</h2><ul><li><strong>Formatted</strong></li></ul><script>steal()</script>",
            },
          }),
        ),
      );
    };
    const detail = await new FetchJiraClient("https://jira.example.test", {
      type: "bearer",
      token: "fake-token",
    }).getIssue("DEV-1");
    assert.match(requestUrl, /expand=renderedFields/u);
    assert.match(detail.descriptionHtml ?? "", /<strong>Formatted<\/strong>/u);
    assert.doesNotMatch(detail.descriptionHtml ?? "", /script|steal/u);
  });
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

    const client = new FetchJiraClient("https://jira.example.test", {
      type: "bearer",
      token: "fake-token",
    });
    assert.equal((await client.getCurrentUser()).displayName, "User");
    assert.equal((await client.getAssignedIssues())[0]?.key, "DEV-1");
    assert.equal((await client.searchIssues("workflow"))[0]?.key, "DEV-1");
    const detail = await client.getIssue("DEV-1");
    assert.equal(detail.description, "Details");
    assert.equal(detail.issueType, "Task");
    assert.equal(detail.assignee, "Developer");
    assert.equal(
      requests[0]?.url,
      "https://jira.example.test/rest/api/2/myself",
    );
    assert.equal(
      new Headers(requests[0]?.init?.headers).get("authorization"),
      "Bearer fake-token",
    );
    assert.match(String(requests[3]?.url), /issue\/DEV-1/u);
  });

  void it("maps authentication failures without exposing response bodies", async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response("sensitive server response", { status: 401 }),
      );
    const client = new FetchJiraClient("https://jira.example.test", {
      type: "bearer",
      token: "fake-token",
    });
    await assert.rejects(client.getCurrentUser(), (error: unknown) => {
      assert.ok(error instanceof JiraRequestError);
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /sensitive/u);
      return true;
    });
  });

  void it("uses Cloud email and API token with basic authentication", async () => {
    let authorization = "";
    let requestUrl = "";
    globalThis.fetch = (input, init) => {
      requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Promise.resolve(
        new Response(JSON.stringify({ accountId: "u1", displayName: "User" }), {
          status: 200,
        }),
      );
    };
    const client = new FetchJiraClient("https://team.atlassian.net", {
      type: "basic",
      email: "user@example.com",
      token: "fake-api-token",
    });
    await client.getCurrentUser();
    assert.equal(
      authorization,
      `Basic ${Buffer.from("user@example.com:fake-api-token").toString("base64")}`,
    );
    assert.equal(requestUrl, "https://team.atlassian.net/rest/api/3/myself");
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
      created: "2026-09-28T00:00:00Z",
      issuetype: { name: "Task" },
      priority: { name: "High" },
      assignee: { displayName: "Developer" },
      reporter: { displayName: "Reporter" },
      parent: { key: "DEV-0" },
      labels: ["local-first"],
    },
  };
}
