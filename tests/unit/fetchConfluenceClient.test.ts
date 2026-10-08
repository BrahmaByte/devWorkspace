import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  ConfluenceRequestError,
  FetchConfluenceClient,
  sanitizeConfluenceHtml,
} from "../../src/infrastructure/confluence/fetchConfluenceClient";

const originalFetch = globalThis.fetch;
void afterEach(() => {
  globalThis.fetch = originalFetch;
});

void describe("Confluence REST provider", () => {
  void it("identifies interactive macros instead of silently omitting them", async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: "42",
            title: "Wiki",
            body: {
              export_view: {
                value:
                  '<p>Before</p><iframe src="https://external.test">Active content</iframe><p>After</p>',
              },
            },
            _links: { webui: "/pages/42" },
          }),
        ),
      );
    const document = await new FetchConfluenceClient(
      "https://wiki.example.test",
      { type: "bearer", token: "fake-token" },
    ).readPage("42");
    assert.match(document.html, /Interactive macro unavailable/u);
    assert.doesNotMatch(document.html, /iframe|external.test|Active content/u);
    assert.match(document.mediaWarnings?.join(" ") ?? "", /original page/u);
  });
  void it("retains static macro semantics while removing arbitrary attributes and active content", () => {
    const rendered = sanitizeConfluenceHtml(
      '<div class="confluence-information-macro evil" onclick="bad()"><p>Information</p></div><span class="status-macro" style="color:red">Ready</span><details open><summary>Expand</summary><dl><dt>Key</dt><dd>Value</dd></dl></details><script>bad()</script><iframe src="https://evil.test">bad()</iframe>',
    );
    assert.match(rendered.html, /class="reader-macro-panel"/u);
    assert.match(rendered.html, /class="reader-macro-status"/u);
    assert.match(rendered.html, /<details><summary>Expand<\/summary><dl>/u);
    assert.doesNotMatch(
      rendered.html,
      /onclick|style=|evil|script|iframe|bad\(\)| open/u,
    );
  });
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
    assert.equal(
      searchUrl.searchParams.get("cql"),
      'type=page AND text ~ "release \\"guide\\""',
    );
    assert.doesNotMatch(searchUrl.searchParams.get("expand") ?? "", /body/u);
  });

  void it("delivers sanitized text before media and downloads at most four images concurrently", async () => {
    let active = 0;
    let maximum = 0;
    let loaded = 0;
    let earlyContent = false;
    const images = Array.from(
      { length: 9 },
      (_, index) => `<img src="/download/${index}.svg">`,
    ).join("");
    globalThis.fetch = async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/download/")) {
        assert.equal(earlyContent, true);
        active++;
        maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => setImmediate(resolve));
        active--;
        loaded++;
        return new Response(
          '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
          {
            headers: { "content-type": "image/svg+xml" },
          },
        );
      }
      return new Response(
        JSON.stringify({
          id: "42",
          title: "Guide",
          _links: { webui: "/pages/42" },
          body: {
            export_view: {
              value: `<h1>Ready</h1><script>unsafe()</script>${images}`,
            },
          },
        }),
      );
    };
    const result = await new FetchConfluenceClient(
      "https://confluence.example.test",
      { type: "bearer", token: "fake-token" },
    ).readPage("42", (document) => {
      assert.equal(loaded, 0);
      assert.match(document.html, /Ready/u);
      assert.doesNotMatch(document.html, /script|unsafe|fake-token/u);
      assert.equal(document.mediaLoading, true);
      earlyContent = true;
    });
    assert.equal(maximum, 4);
    assert.equal(loaded, 9);
    assert.equal(result.media?.length, 9);
    assert.equal(result.mediaLoading, undefined);
    assert.deepEqual(
      result.media?.map((item) => item.id),
      Array.from({ length: 9 }, (_, index) => `reader-media-${index + 1}`),
    );
  });

  void it("requests only one rendered body and falls back when export rendering is unavailable", async () => {
    const urls: URL[] = [];
    globalThis.fetch = (input) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      urls.push(url);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "42",
            title: "Guide",
            _links: { webui: "/pages/42" },
            body: url.searchParams.get("expand")?.startsWith("body.view,")
              ? { view: { value: "<p>Fallback rendering</p>" } }
              : {},
          }),
        ),
      );
    };
    const result = await new FetchConfluenceClient(
      "https://confluence.example.test",
      { type: "bearer", token: "fake-token" },
    ).readPage("42");
    assert.match(result.html, /Fallback rendering/u);
    assert.equal(urls.length, 2);
    assert.doesNotMatch(
      urls[0]?.searchParams.get("expand") ?? "",
      /body.view/u,
    );
    assert.doesNotMatch(
      urls[1]?.searchParams.get("expand") ?? "",
      /body.export_view/u,
    );
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
  void it("loads same-origin images and exported diagrams without exposing credentials", async () => {
    const requests: string[] = [];
    globalThis.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requests.push(url);
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer fake-token",
      );
      if (url.includes("/download/"))
        return Promise.resolve(
          new Response(
            '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="blue"/></svg>',
            { headers: { "content-type": "image/svg+xml" } },
          ),
        );
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "42",
            title: "Guide",
            status: "current",
            space: { name: "Engineering", key: "ENG" },
            version: {
              number: 4,
              when: "2026-10-06T10:00:00Z",
              by: { displayName: "Editor" },
            },
            history: {
              createdDate: "2026-10-01T10:00:00Z",
              createdBy: { displayName: "Author" },
            },
            metadata: { labels: { results: [{ name: "guide" }] } },
            _links: { webui: "/display/ENG/Guide" },
            body: {
              view: { value: "<p>Fallback</p>" },
              export_view: {
                value:
                  '<h1>Overview</h1><img src="/download/attachments/42/diagram.svg?a=1&amp;b=2" alt="Architecture"><img src="https://evil.test/tracker"><table><tr><td colspan="2">Cell</td></tr></table><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5"/></svg>',
              },
            },
          }),
        ),
      );
    };
    const document = await new FetchConfluenceClient(
      "https://confluence.example.test",
      { type: "bearer", token: "fake-token" },
    ).readPage("42");
    assert.match(document.html, /data-reader-media="reader-media-1"/u);
    assert.match(document.html, /colspan="2"/u);
    assert.doesNotMatch(document.html, /evil|src=|Fallback/u);
    assert.equal(document.media?.length, 2);
    assert.match(
      document.media?.[0]?.dataUrl ?? "",
      /^data:image\/svg\+xml;base64,/u,
    );
    assert.equal(document.media?.[0]?.alt, "Architecture");
    assert.deepEqual(document.metadata, {
      spaceKey: "ENG",
      version: 4,
      status: "current",
      createdBy: "Author",
      updatedBy: "Editor",
      createdAt: "2026-10-01T10:00:00Z",
      labels: ["guide"],
    });
    assert.equal(requests.length, 2);
    assert.match(requests[1] ?? "", /a=1&b=2/u);
    assert.ok(
      document.mediaWarnings?.some((message) => message.includes("external")),
    );
    assert.doesNotMatch(JSON.stringify(document), /fake-token/u);
  });
  void it("keeps page content visible when an image is inaccessible or oversized", async () => {
    globalThis.fetch = (input) =>
      Promise.resolve(
        (typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url
        ).includes("/download/")
          ? new Response("blocked", { status: 403 })
          : new Response(
              JSON.stringify({
                id: "42",
                title: "Guide",
                _links: { webui: "/pages/42" },
                body: {
                  view: {
                    value: '<p>Still readable</p><img src="/download/42.png">',
                  },
                },
              }),
            ),
      );
    const document = await new FetchConfluenceClient(
      "https://confluence.example.test",
      { type: "bearer", token: "fake-token" },
    ).readPage("42");
    assert.match(document.html, /Still readable/u);
    assert.equal(document.media?.length, 0);
    assert.ok(document.mediaWarnings?.length);
  });
  void it("supports embedded image data without any secondary network request", async () => {
    let calls = 0;
    const svg = Buffer.from(
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
    ).toString("base64");
    globalThis.fetch = () => {
      calls++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "42",
            title: "Guide",
            _links: { webui: "/pages/42" },
            body: {
              view: {
                value: `<img src="data:image/svg+xml;base64,${svg}" alt="Embedded diagram">`,
              },
            },
          }),
        ),
      );
    };
    const document = await new FetchConfluenceClient(
      "https://confluence.example.test",
      { type: "bearer", token: "fake-token" },
    ).readPage("42");
    assert.equal(calls, 1);
    assert.equal(document.media?.length, 1);
    assert.equal(document.media?.[0]?.alt, "Embedded diagram");
  });
});
