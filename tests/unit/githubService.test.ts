import assert from "node:assert/strict";
import { it } from "node:test";
import {
  GitHubService,
  githubSecretKey,
} from "../../src/application/services/githubService";
import { VscodeHttpTransport } from "../../src/infrastructure/http/vscodeHttpTransport";
import { parseWebviewRequest } from "../../src/webview/protocol/validation";

const repo = (id: number, owner = "example-org") => ({
  id,
  name: "repo-" + id,
  owner: { login: owner, type: "Organization" },
  description: "<script>metadata is text</script>",
  private: true,
  archived: false,
  clone_url: "https://untrusted.invalid/never-use",
});
function fixture(
  handler: (url: URL, headers: Headers) => Promise<Response> | Response,
) {
  const storage = new Map<string, string>();
  const secrets = {
    get: (key: string) => Promise.resolve(storage.get(key)),
    store: (key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      storage.delete(key);
      return Promise.resolve();
    },
  };
  const transport = new VscodeHttpTransport((input, init) =>
    Promise.resolve(
      handler(
        new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        ),
        new Headers(init?.headers),
      ),
    ),
  );
  return { service: new GitHubService(secrets, transport), storage };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
void it("keeps the PAT in SecretStorage and lists authorized organizations with paginated repositories", async () => {
  const urls: string[] = [];
  const { service, storage } = fixture((url, headers) => {
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(headers.get("authorization"), "Bearer fake-pat-test-only");
    urls.push(url.pathname + url.search);
    if (url.pathname === "/user") return json({ login: "example-user" });
    if (url.pathname === "/user/orgs")
      return json([{ login: "example-org" }, { login: "empty-org" }]);
    return json(
      url.searchParams.get("page") === "1"
        ? Array.from({ length: 100 }, (_, i) => repo(i + 1))
        : [repo(101)],
    );
  });
  assert.equal((await service.state()).connected, false);
  await service.connect("fake-pat-test-only");
  assert.equal(storage.get(githubSecretKey), "fake-pat-test-only");
  const state = await service.refresh();
  assert.deepEqual(state.organizations, ["empty-org", "example-org"]);
  assert.equal(JSON.stringify(state).includes("fake-pat-test-only"), false);
  await assert.rejects(
    service.browse("not-a-member"),
    /Select an organization/u,
  );
  const first = await service.browse("example-org");
  assert.equal(first.repositories.length, 100);
  assert.equal(first.hasMore, true);
  const second = await service.browse("example-org", true);
  assert.equal(second.repositories.length, 101);
  assert.equal(second.hasMore, false);
  assert.equal((await service.repository("101")).name, "repo-101");
  await assert.rejects(service.repository("999"), /expired/u);
  await service.disconnect();
  assert.equal(storage.size, 0);
  assert.equal((await service.state()).repositories.length, 0);
  await assert.rejects(service.repository("101"), /Connect GitHub/u);
  assert.ok(
    urls.includes(
      "/orgs/example-org/repos?type=all&per_page=100&sort=updated&page=2",
    ),
  );
});
void it("invalidates repository selections when another window changes credentials", async () => {
  const { service, storage } = fixture((url) =>
    url.pathname === "/user"
      ? json({ login: "user" })
      : url.pathname === "/user/orgs"
        ? json([{ login: "example-org" }])
        : json([repo(1)]),
  );
  await service.connect("fake-pat");
  await service.refresh();
  await service.browse("example-org");
  storage.set(githubSecretKey, "fake-replacement-pat");
  assert.equal((await service.state()).repositories.length, 0);
  await assert.rejects(service.repository("1"), /expired/u);
});
void it("discovers organizations for limited fine-grained tokens and reports access errors without raw bodies", async () => {
  const { service } = fixture((url) =>
    url.pathname === "/user"
      ? json({ login: "user" })
      : url.pathname === "/user/orgs"
        ? json({ message: "fake-secret-never-display" }, 403)
        : json([repo(1)]),
  );
  await service.connect("fake-fine-grained-only");
  const state = await service.refresh();
  assert.deepEqual(state.organizations, ["example-org"]);
  assert.match(state.message, /membership is limited/u);
  const invalid = fixture(() =>
    json({ message: "fake-secret-never-display" }, 401),
  );
  await assert.rejects(
    invalid.service.connect("fake-invalid-only"),
    (error) =>
      error instanceof Error &&
      error.message.includes("rejected") &&
      !error.message.includes("fake-secret"),
  );
  assert.equal(invalid.storage.size, 0);
  await assert.rejects(service.connect("fake token"), /without whitespace/u);
});
void it("supports Enterprise Managed User logins and repository owners", async () => {
  const login = "managed-user_acme";
  const { service } = fixture((url) => {
    if (url.pathname === "/user") return json({ login });
    if (url.pathname === "/user/orgs") return json([]);
    return json([repo(1, login)]);
  });
  await service.connect("fake-managed-user-pat");
  const state = await service.refresh();
  assert.equal(state.login, login);
  const repositories = await service.browse(login);
  assert.equal(repositories.repositories[0]?.owner, login);
  assert.equal(
    parseWebviewRequest({
      type: "github.repositories",
      owner: login,
      more: false,
    }).ok,
    true,
  );
});
void it("bounds managed-user names and maps GitHub failures without exposing response bodies", async () => {
  const validMaximum = "a" + "b".repeat(33) + "_acme";
  assert.equal(validMaximum.length, 39);
  for (const owner of ["_managed_acme", "managed/acme", "a".repeat(40)])
    assert.equal(
      parseWebviewRequest({
        type: "github.repositories",
        owner,
        more: false,
      }).ok,
      false,
    );
  assert.equal(
    parseWebviewRequest({
      type: "github.repositories",
      owner: validMaximum,
      more: false,
    }).ok,
    true,
  );

  const rateLimited = fixture(
    () =>
      new Response('{"message":"fake-sensitive-body"}', {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      }),
  );
  await assert.rejects(
    rateLimited.service.connect("fake-rate-limited-pat"),
    (error) =>
      error instanceof Error &&
      error.message.includes("rate-limited") &&
      !error.message.includes("fake-sensitive-body"),
  );
  assert.equal(rateLimited.storage.size, 0);
});
void it("rejects off-origin credential redirects, invalid metadata and stale in-flight results", async () => {
  const redirected = fixture(
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://untrusted.invalid/" },
      }),
  );
  await assert.rejects(
    redirected.service.connect("fake-pat"),
    /could not be reached/u,
  );
  let resolve: ((response: Response) => void) | undefined;
  const { service } = fixture((url) =>
    url.pathname === "/user"
      ? json({ login: "user" })
      : url.pathname === "/user/orgs"
        ? json([{ login: "example-org" }])
        : new Promise<Response>((r) => {
            resolve = r;
          }),
  );
  await service.connect("fake-pat");
  await service.refresh();
  const load = service.browse("example-org");
  await new Promise((r) => setImmediate(r));
  await service.disconnect();
  resolve!(json([repo(1)]));
  await assert.rejects(load, /connection changed/u);
  assert.equal((await service.state()).repositories.length, 0);
  const invalid = fixture((url) =>
    url.pathname === "/user"
      ? json({ login: "user" })
      : url.pathname === "/user/orgs"
        ? json([{ login: "example-org" }])
        : json([{ ...repo(1), name: "../unsafe" }]),
  );
  await invalid.service.connect("fake-pat");
  await invalid.service.refresh();
  await assert.rejects(
    invalid.service.browse("example-org"),
    /invalid repository/u,
  );
});
void it("rejects Webview credentials, arbitrary URLs and paths, and unknown GitHub actions", () => {
  for (const value of [
    { type: "github.configure", token: "fake" },
    { type: "github.clone", id: "1", url: "https://untrusted.invalid" },
    { type: "github.clone", id: "1", localPath: "/safe/fake" },
    { type: "github.repositories", owner: "../unsafe", more: false },
    { type: "github.delete" },
  ])
    assert.equal(parseWebviewRequest(value).ok, false);
  assert.equal(
    parseWebviewRequest({ type: "github.clone", id: "123" }).ok,
    true,
  );
  assert.equal(
    parseWebviewRequest({
      type: "github.repositories",
      owner: "example-org",
      more: true,
    }).ok,
    true,
  );
});
