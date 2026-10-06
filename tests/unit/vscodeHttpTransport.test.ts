import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UnsafeNetworkRedirectError,
  VscodeHttpTransport,
  type FetchImplementation,
} from "../../src/infrastructure/http/vscodeHttpTransport";

void describe("VS Code HTTP transport", () => {
  void it("allows only approved public media redirects and strips provider credentials", async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const transport = new VscodeHttpTransport((input, init) => {
      requests.push({
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        headers: new Headers(init?.headers),
      });
      return Promise.resolve(
        requests.length === 1
          ? new Response(null, {
              status: 302,
              headers: {
                location: "https://api.media.atlassian.com/file/fake/binary",
              },
            })
          : new Response("image"),
      );
    });
    await transport.fetch(
      "https://confluence.example.test/download/image",
      { headers: { Authorization: "Bearer fake", Cookie: "fake-cookie" } },
      ["api.media.atlassian.com"],
    );
    assert.equal(requests[0]?.headers.get("authorization"), "Bearer fake");
    assert.equal(requests[1]?.headers.get("authorization"), null);
    assert.equal(requests[1]?.headers.get("cookie"), null);
    const unsafe = new VscodeHttpTransport(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.test/file" },
        }),
      ),
    );
    await assert.rejects(
      unsafe.fetch("https://confluence.example.test/download/image", {}, [
        "api.media.atlassian.com",
      ]),
      UnsafeNetworkRedirectError,
    );
  });
  void it("follows bounded same-origin redirects and preserves credentials", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetchImplementation: FetchImplementation = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requests.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Promise.resolve(
        requests.length === 1
          ? new Response(undefined, {
              status: 307,
              headers: { location: "/canonical" },
            })
          : new Response("{}", { status: 200 }),
      );
    };
    const transport = new VscodeHttpTransport(fetchImplementation);

    const response = await transport.fetch("https://jira.example.test/rest", {
      headers: { Authorization: "Bearer fake-token" },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(requests, [
      {
        url: "https://jira.example.test/rest",
        authorization: "Bearer fake-token",
      },
      {
        url: "https://jira.example.test/canonical",
        authorization: "Bearer fake-token",
      },
    ]);
  });

  void it("rejects redirects that could disclose credentials", async () => {
    const transport = new VscodeHttpTransport(() =>
      Promise.resolve(
        new Response(undefined, {
          status: 302,
          headers: { location: "https://login.example.test/" },
        }),
      ),
    );

    await assert.rejects(
      transport.fetch("https://jira.example.test/rest", {
        headers: { Authorization: "Bearer fake-token" },
      }),
      UnsafeNetworkRedirectError,
    );
  });
});
