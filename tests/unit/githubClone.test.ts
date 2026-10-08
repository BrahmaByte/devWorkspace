import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import { GitHubError } from "../../src/application/services/githubService";

void it("clones with native Git, confirms the destination and scopes/disposes PAT credentials", async () => {
  class Uri {
    public scheme = "file";
    public fsPath: string;
    public constructor(private readonly url: string) {
      this.scheme = new URL(url).protocol.slice(0, -1);
      this.fsPath = new URL(url).pathname;
    }
    public toString() {
      return this.url;
    }
    public static parse(url: string) {
      return new Uri(url);
    }
    public static joinPath(uri: Uri, name: string) {
      return new Uri(uri.toString().replace(/\/$/u, "") + "/" + name);
    }
  }
  class FileSystemError extends Error {
    public code = "FileNotFound";
  }
  const parent = Uri.parse("file:///safe/fake/parent"),
    target = Uri.joinPath(parent, "repo"),
    calls: unknown[] = [];
  let existing = false,
    trusted = true,
    confirmed = true,
    disposed = false,
    failed = false;
  const secrets = { get: () => Promise.resolve("fake-pat-test-only") };
  const api = {
    clone: async (url: Uri, options: unknown) => {
      calls.push([url.toString(), options]);
      const provider = calls[0] as {
        getCredentials(uri: Uri): Promise<{ password: string } | undefined>;
      };
      assert.equal(
        (
          await provider.getCredentials(
            Uri.parse("https://github.com/example-org/repo.git"),
          )
        )?.password,
        "fake-pat-test-only",
      );
      assert.equal(
        await provider.getCredentials(Uri.parse("https://untrusted.invalid")),
        undefined,
      );
      assert.equal(
        await provider.getCredentials(
          Uri.parse("https://github.com/other/repo.git"),
        ),
        undefined,
      );
      if (failed) throw Error("fake-raw-token-should-not-show");
      return target;
    },
    registerCredentialsProvider: (provider: {
      getCredentials: (uri: Uri) => Promise<unknown>;
    }) => {
      calls.push(provider);
      return {
        dispose: () => {
          disposed = true;
        },
      };
    },
  };
  const vscode = {
    Uri,
    FileSystemError,
    FileType: { Directory: 2 },
    workspace: {
      get isTrusted() {
        return trusted;
      },
      fs: {
        stat: (uri: Uri) => {
          if (uri.toString() === target.toString() && !existing)
            throw new FileSystemError();
          return Promise.resolve({ type: 2 });
        },
      },
    },
    extensions: {
      getExtension: () => ({
        activate: () => Promise.resolve({ enabled: true, getAPI: () => api }),
      }),
    },
    window: {
      showOpenDialog: () => Promise.resolve([parent]),
      showWarningMessage: () =>
        Promise.resolve(confirmed ? "Clone and add" : undefined),
    },
    commands: {
      executeCommand: () => {
        throw Error("Native API should be used when available");
      },
    },
  };
  const exports: Record<string, unknown> = {};
  runInNewContext(
    readFileSync("dist/src/infrastructure/vscode/vscodeGitHubClone.js", "utf8"),
    {
      exports,
      require: (name: string) =>
        name === "vscode"
          ? vscode
          : { GitHubError, githubSecretKey: "fake-key" },
      URL,
    },
  );
  const Constructor = exports.VscodeGitHubClone as new (
    storage: typeof secrets,
  ) => {
    clone(repo: {
      id: string;
      owner: string;
      name: string;
      description: string;
      private: boolean;
      archived: boolean;
    }): Promise<string | undefined>;
  };
  const clone = new Constructor(secrets),
    repo = {
      id: "1",
      owner: "example-org",
      name: "repo",
      description: "",
      private: true,
      archived: false,
    };
  assert.equal(await clone.clone(repo), target.fsPath);
  assert.equal(disposed, true);
  assert.equal(JSON.stringify(calls).includes("fake-pat"), false);
  const provider = calls[0] as { getCredentials(uri: Uri): Promise<unknown> };
  assert.equal(
    await provider.getCredentials(Uri.parse("https://github.com")),
    undefined,
  );
  const options = (calls[1] as unknown[])[1] as {
    recursive: boolean;
    postCloneAction: string;
  };
  assert.equal(
    (calls[1] as unknown[])[0],
    "https://github.com/example-org/repo.git",
  );
  assert.equal(options.recursive, false);
  assert.equal(options.postCloneAction, "none");
  existing = true;
  await assert.rejects(clone.clone(repo), /already exists/u);
  existing = false;
  confirmed = false;
  assert.equal(await clone.clone(repo), undefined);
  confirmed = true;
  trusted = false;
  await assert.rejects(clone.clone(repo), /Trust/u);
  trusted = true;
  failed = true;
  await assert.rejects(
    clone.clone(repo),
    (error) =>
      error instanceof Error && !error.message.includes("fake-raw-token"),
  );
  assert.equal(disposed, true);
});
