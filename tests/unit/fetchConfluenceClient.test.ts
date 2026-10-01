import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  ConfluenceRequestError,
  FetchConfluenceClient,
} from "../../src/infrastructure/confluence/fetchConfluenceClient";

const originalFetch = globalThis.fetch;
void afterEach(() => {
  globalThis.fetch = originalFetch;
});

void describe("Confluence REST provider", () => {
  void it("uses bearer authentication and performs bounded metadata search", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requests.push({ url, init });
      const body = url.includes("content/search")
        ? {
            results: [
              {
                id: "42",
                title: "Runbook",
                space: { name: "Engineering" },
                version: { when: "2026-09-29T00:00:00Z" },
                _links: { webui: "/display/ENG/Runbook" },
              },
            ],
          }
        : { username: "tester" };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200 }),
      );
    };
    const client = new FetchConfluenceClient(
      "https://confluence.example.test",
      { type: "bearer", token: "fake-token" },
    );
    await client.testConnection();
    const pages = await client.searchPages('release "guide"');
    assert.equal(pages[0]?.title, "Runbook");
    assert.equal(pages[0]?.spaceName, "Engineering");
    assert.equal(
      new Headers(requests[0]?.init?.headers).get("authorization"),
      "Bearer fake-token",
    );
    const searchUrl = new URL(requests[1]?.url ?? "");
    assert.equal(searchUrl.searchParams.get("limit"), "25");
    assert.match(searchUrl.searchParams.get("cql") ?? "", /type=page/u);
    assert.doesNotMatch(searchUrl.searchParams.get("expand") ?? "", /body/u);
  });

  void it("maps authentication failures without exposing response bodies", async () => {
    globalThis.fetch = () =>
      Promise.resolve(new Response("sensitive response", { status: 401 }));
    const client = new FetchConfluenceClient(
      "https://confluence.example.test",
      { type: "bearer", token: "fake-token" },
    );
    await assert.rejects(client.testConnection(), (error: unknown) => {
      assert.ok(error instanceof ConfluenceRequestError);
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /sensitive/u);
      return true;
    });
  });

  void it("sanitizes reader content and builds a table of contents", async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: "42",
            title: "Runbook",
            space: { name: "Engineering" },
            version: { when: "2026-09-29T00:00:00Z" },
            _links: { webui: "/display/ENG/Runbook" },
            body: {
              view: {
                value:
                  '<h1 onclick="steal()">Recovery</h1><p><strong>Safe</strong></p><script>steal()</script><img src="https://evil.test/x">',
              },
            },
          }),
          { status: 200 },
        ),
      );
    const client = new FetchConfluenceClient(
      "https://confluence.example.test",
      { type: "bearer", token: "fake-token" },
    );
    const document = await client.readPage("42");
    assert.deepEqual(document.headings, [
      { id: "reader-section-1", level: 1, text: "Recovery" },
    ]);
    assert.match(document.html, /<h1 data-reader-id="reader-section-1">/u);
    assert.doesNotMatch(document.html, /onclick|script|steal|img|evil/iu);
  });

  void it("uses Cloud email and API token with basic authentication", async () => {
    let authorization = "";
    globalThis.fetch = (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Promise.resolve(
        new Response(JSON.stringify({ accountId: "u1" }), { status: 200 }),
      );
    };
    const client = new FetchConfluenceClient(
      "https://team.atlassian.net/wiki",
      {
        type: "basic",
        email: "user@example.com",
        token: "fake-api-token",
      },
    );
    await client.testConnection();
    assert.equal(
      authorization,
      `Basic ${Buffer.from("user@example.com:fake-api-token").toString("base64")}`,
    );
  });
});
