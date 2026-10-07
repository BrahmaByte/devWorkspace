import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import {
  createExtensionProxyFetch,
  validateProxyUrl,
  validateProxyCa,
} from "../../src/infrastructure/http/extensionProxy";
import { VscodeHttpTransport } from "../../src/infrastructure/http/vscodeHttpTransport";
import { parseWebviewRequest } from "../../src/webview/protocol/validation";
import { networkDiagnosticHint } from "../../src/infrastructure/http/networkDiagnostics";
import {
  ProxyTunnelError,
  connectionErrorMessage,
  shouldOfferProxySettings,
} from "../../src/application/services/integrationError";

// Generate ephemeral test credentials; no private key is stored in the repository.
async function testTlsCertificate(): Promise<{ key: string; cert: string }> {
  const directory = await mkdtemp(join(tmpdir(), "devdashboard-proxy-test-"));
  try {
    const keyPath = join(directory, "key.pem");
    const certPath = join(directory, "cert.pem");
    await promisify(execFile)(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { timeout: 15000 },
    );
    return {
      key: await readFile(keyPath, "utf8"),
      cert: await readFile(certPath, "utf8"),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void describe("Extension-only proxy", () => {
  void it("logs status and nested network failures without exposing request or error data", async () => {
    const logs: string[] = [];
    const failure = new Error("fake-secret-error", {
      cause: Object.assign(new Error("fake-secret-cause"), {
        code: "ENOTFOUND",
      }),
    });
    let fail = false;
    const fetch = createExtensionProxyFetch(
      () => Promise.resolve(undefined),
      () =>
        fail
          ? Promise.reject(failure)
          : Promise.resolve(new Response("fake-secret-body", { status: 401 })),
      (message) => logs.push(message),
    );
    const url = "https://fake-secret-host.test/private?token=fake-secret-query";
    const init = {
      headers: { Authorization: "Bearer fake-secret-header" },
      body: "fake-secret-request",
      method: "POST",
    };
    assert.equal((await fetch(url, init)).status, 401);
    fail = true;
    await assert.rejects(
      fetch(url, init),
      (error: unknown) => error === failure,
    );
    const output = logs.join("\n");
    assert.match(output, /request 1.*HTTP 401; elapsed \d+ ms/);
    assert.match(output, /Provider authentication\/permission rejected/);
    assert.match(output, /request 2.*ENOTFOUND: DNS lookup failed/);
    assert.match(output, /delegated to VS Code/);
    assert.match(
      output,
      /PAC\/bypass rules and supported authentication negotiation managed by VS Code/u,
    );
    assert.doesNotMatch(output, /fake-secret|Authorization|Bearer/);
    for (const code of [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "ERR_PROXY_CONNECTION_FAILED",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "CERT_HAS_EXPIRED",
    ])
      assert.match(
        networkDiagnosticHint({ cause: { code } }),
        new RegExp(code),
      );
    assert.match(
      networkDiagnosticHint({ status: 407 }),
      /Proxy authentication rejected/,
    );
    assert.match(
      networkDiagnosticHint(new DOMException("fake-secret", "TimeoutError")),
      /timed out/,
    );
    assert.doesNotMatch(
      networkDiagnosticHint({ code: "fake-secret", message: "fake-secret" }),
      /fake-secret/,
    );
  });

  void it("explains proxy credentials and keeps the password prompt masked", async () => {
    const source = await readFile(
      "src/infrastructure/vscode/vscodeExtensionProxy.ts",
      "utf8",
    );
    assert.match(source, /IT-provided proxy username for Basic authentication/);
    assert.match(source, /not your Jira or Confluence credentials/);
    assert.match(source, /Leave empty if authentication is not required/);
    assert.match(
      source,
      /Recommended for corporate networks on Mac and Windows/u,
    );
    assert.match(
      source,
      /Does not negotiate NTLM, Kerberos, Digest or corporate SSO/u,
    );
    assert.match(source, /workbench.action.openSettings/u);
    assert.match(
      source,
      /return value \? \(JSON\.parse\(value\) as ExtensionProxyConfig\) : undefined/u,
    );
    assert.doesNotMatch(source, /enabled: true|config\?\.enabled/u);
    assert.doesNotMatch(source, /\.update\(|NODE_TLS_REJECT_UNAUTHORIZED/u);
    assert.match(
      source,
      /title: "Proxy password",\s+prompt:\s+"Enter the password for your proxy account\. Input is hidden; proxy credentials are saved securely in VS Code SecretStorage\.",\s+password: true/,
    );
  });

  void it("validates endpoints without allowing embedded credentials", () => {
    assert.equal(
      validateProxyUrl("http://proxy.example.test:8080"),
      "http://proxy.example.test:8080",
    );
    assert.equal(
      validateProxyUrl("https://proxy.example.test"),
      "https://proxy.example.test",
    );
    for (const value of [
      "socks://host:1080",
      "http://user:password@host",
      "http://host/path",
      "http://host?token=fake",
      "http://host#fragment",
      "http://host\n",
      "not a url",
    ])
      assert.throws(() => validateProxyUrl(value));
    assert.throws(() => validateProxyCa("fake certificate"));
    assert.throws(() =>
      validateProxyCa(
        "-----BEGIN CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----",
      ),
    );
  });
  void it("allows only the configure action, never credentials in Webview messages", () => {
    assert.equal(parseWebviewRequest({ type: "network.configure" }).ok, true);
    assert.equal(
      parseWebviewRequest({
        type: "network.configure",
        url: "http://proxy",
        password: "fake-password",
      }).ok,
      false,
    );
  });
  void it("uses the supplied VS Code fetch when no override exists", async () => {
    let calls = 0;
    const fetch = createExtensionProxyFetch(
      () => Promise.resolve(undefined),
      () => {
        calls++;
        return Promise.resolve(new Response("default"));
      },
    );
    assert.equal(
      await (await fetch("https://jira.example.test")).text(),
      "default",
    );
    assert.equal(calls, 1);
  });
  void it("sends only proxy credentials to CONNECT and never falls back on rejection", async () => {
    const logs: string[] = [];
    const proxy = createServer();
    let calls = 0;
    let proxyAuth: string | undefined;
    let destinationAuth: string | undefined;
    proxy.on("connect", (request, socket) => {
      proxyAuth = request.headers["proxy-authorization"];
      destinationAuth = request.headers.authorization;
      socket.end(
        "HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n",
      );
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    try {
      const address = proxy.address();
      assert.ok(address && typeof address !== "string");
      const transport = new VscodeHttpTransport(
        createExtensionProxyFetch(
          () =>
            Promise.resolve({
              url: `http://127.0.0.1:${address.port}`,
              username: "fake-user",
              password: "fake-password",
            }),
          () => {
            calls++;
            return Promise.resolve(new Response());
          },
          (message) => logs.push(message),
        ),
      );
      await assert.rejects(
        transport.fetch("https://jira.example.test/rest", {
          headers: { Authorization: "Bearer fake-token" },
        }),
        { status: 407 },
      );
      assert.equal(
        proxyAuth,
        "Basic " + Buffer.from("fake-user:fake-password").toString("base64"),
      );
      assert.equal(destinationAuth, undefined);
      assert.equal(calls, 0);
      assert.match(
        logs.join("\n"),
        /extension-only HTTP proxy; Basic authentication=true; custom CA=false/,
      );
      assert.match(
        logs.join("\n"),
        /Proxy CONNECT rejected \(HTTP 407\).*Proxy authentication rejected/,
      );
      assert.doesNotMatch(
        logs.join("\n"),
        /fake-user|fake-password|fake-token|127\.0\.0\.1|jira\.example/,
      );
    } finally {
      proxy.close();
    }
  });
  void it("reports rejected CONNECT status instead of cancellation, without direct fallback or sensitive logs", async () => {
    let status = 403;
    let calls = 0;
    const proxy = createServer();
    proxy.on("connect", (_, socket) =>
      socket.end(
        `HTTP/1.1 ${status} Mock rejection\r\nContent-Length: 0\r\n\r\n`,
      ),
    );
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    try {
      const address = proxy.address();
      assert.ok(address && typeof address !== "string");
      const logs: string[] = [];
      const signal = new AbortController().signal;
      const transport = new VscodeHttpTransport(
        createExtensionProxyFetch(
          () =>
            Promise.resolve({
              url: `http://127.0.0.1:${address.port}`,
              username: "fake-sensitive-user",
              password: "fake-sensitive-password",
            }),
          () => {
            calls++;
            return Promise.resolve(new Response());
          },
          (message) => logs.push(message),
        ),
      );
      for (const [code, hint] of [
        [403, /Proxy access denied/],
        [302, /redirected/],
        [502, /upstream destination/],
        [407, /Basic authentication, not NTLM/],
        [405, /HTTPS tunneling support/],
        [503, /Proxy server failed/],
        [429, /rate limited/],
      ] as const) {
        status = code;
        logs.length = 0;
        await assert.rejects(
          transport.fetch(
            "https://fake-sensitive-host.test/rest?token=fake-sensitive-query",
            {
              signal,
              headers: { Authorization: "Bearer fake-sensitive-token" },
            },
          ),
          (error: unknown) => {
            assert.ok(error instanceof ProxyTunnelError);
            assert.equal(error.status, code);
            assert.equal(shouldOfferProxySettings(error), true);
            assert.match(connectionErrorMessage("jira", error), hint);
            return true;
          },
        );
        assert.equal(signal.aborted, false);
        const output = logs.join("\n");
        assert.match(
          output,
          new RegExp(`Proxy CONNECT rejected \\(HTTP ${code}\\)`),
        );
        assert.match(output, hint);
        assert.doesNotMatch(
          output,
          /Request cancelled|fake-sensitive|127\.0\.0\.1|Bearer/,
        );
      }
      assert.equal(calls, 0);
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });

  void it("distinguishes caller cancellation from an internal transport abort and checks deeper causes", async () => {
    const abort = new DOMException("fake-private-error", "AbortError");
    assert.match(networkDiagnosticHint(abort), /without a caller cancellation/);
    const controller = new AbortController();
    controller.abort(abort);
    const logs: string[] = [];
    const fetch = createExtensionProxyFetch(
      () => Promise.resolve(undefined),
      () => Promise.reject(abort),
      (message) => logs.push(message),
    );
    await assert.rejects(
      fetch("https://jira.example.test", { signal: controller.signal }),
      (error) => error === abort,
    );
    assert.match(logs.join("\n"), /cancelled by the caller's abort signal/);
    assert.doesNotMatch(logs.join("\n"), /fake-private-error/);
    const timeout = new AbortController();
    timeout.abort(new DOMException("fake-private-timeout", "TimeoutError"));
    assert.match(
      networkDiagnosticHint(abort, timeout.signal),
      /deadline expired/,
    );
    const nested = Object.assign(
      new Error("fake-private", { cause: { code: "CERT_HAS_EXPIRED" } }),
      { name: "AbortError" },
    );
    assert.match(networkDiagnosticHint(nested), /CERT_HAS_EXPIRED/);
  });
  for (const secureProxy of [false, true]) {
    void it(`tunnels HTTPS through an ${secureProxy ? "HTTPS" : "HTTP"} proxy with verified corporate CA and preserved POST body`, async () => {
      const fixture = await testTlsCertificate();
      let originProxyAuth: string | undefined;
      let originAuth: string | undefined;
      let body = "";
      const origin = createHttpsServer(fixture, (req, res) => {
        originProxyAuth = req.headers["proxy-authorization"];
        originAuth = req.headers.authorization;
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          body += chunk;
        });
        req.on("end", () => {
          if (req.url === "/redirect") {
            res.writeHead(302, { location: "https://other.example.test/" });
            res.end();
          } else res.end("proxy success");
        });
      });
      origin.listen(0, "127.0.0.1");
      await once(origin, "listening");
      const originAddress = origin.address();
      assert.ok(originAddress && typeof originAddress !== "string");
      const proxy = secureProxy ? createHttpsServer(fixture) : createServer();
      proxy.on("connect", (_req, downstream, head) => {
        const upstream = connect(originAddress.port, "127.0.0.1", () => {
          downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          downstream.pipe(upstream);
          upstream.pipe(downstream);
        });
        downstream.on("close", () => upstream.destroy());
        downstream.on("error", () => upstream.destroy());
        upstream.on("error", () => downstream.destroy());
      });
      proxy.listen(0, "127.0.0.1");
      await once(proxy, "listening");
      try {
        const address = proxy.address();
        assert.ok(address && typeof address !== "string");
        const config = {
          url: `${secureProxy ? "https" : "http"}://127.0.0.1:${address.port}`,
          username: "fake",
          password: "fake",
          ca: fixture.cert,
        };
        const noFallback = () => {
          throw new Error("Unexpected fallback");
        };
        const transport = new VscodeHttpTransport(
          createExtensionProxyFetch(() => Promise.resolve(config), noFallback),
        );
        const url = `https://127.0.0.1:${originAddress.port}`;
        assert.equal(
          await (
            await transport.fetch(url, {
              method: "POST",
              body: "long  command with  spaces",
              headers: { Authorization: "Bearer fake" },
            })
          ).text(),
          "proxy success",
        );
        assert.equal(body, "long  command with  spaces");
        assert.equal(originAuth, "Bearer fake");
        assert.equal(originProxyAuth, undefined);
        await assert.rejects(
          transport.fetch(url + "/redirect"),
          /trusted origin/u,
        );
        const untrusted = new VscodeHttpTransport(
          createExtensionProxyFetch(
            () => Promise.resolve({ ...config, ca: undefined }),
            noFallback,
          ),
        );
        await assert.rejects(untrusted.fetch(url));
      } finally {
        proxy.close();
        origin.close();
      }
    });
  }
});
