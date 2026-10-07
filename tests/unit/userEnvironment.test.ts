import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, it } from "node:test";
import {
  UserEnvironment,
  environmentValue,
  validateEnvironmentName,
  windowsEnvironmentScript,
} from "../../src/platform/userEnvironment";
const directories: string[] = [];
async function home() {
  const path = await mkdtemp(join(tmpdir(), "devdashboard-user-env-"));
  directories.push(path);
  return path;
}
void afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const unix = { skip: process.platform === "win32" };

void describe("Persistent user environment", () => {
  void it("rejects credentials, control characters and startup hooks while preserving literal append semantics", () => {
    for (const name of [
      "HOME",
      "USER",
      "NODE_OPTIONS",
      "NODE_TLS_REJECT_UNAUTHORIZED",
      "PYTHONSTARTUP",
      "GIT_ASKPASS",
      "JAVA_TOOL_OPTIONS",
      "LD_PRELOAD",
      "DYLD_LIBRARY_PATH",
      "VSCODE_TEST",
      "API_TOKEN",
      "DB_PASSWORD",
      "BASH_ENV",
      "ENV",
      "A;touch",
      "A\nB",
    ])
      assert.throws(() => validateEnvironmentName(name));
    for (const value of [
      "",
      "line\nnext",
      "bad\0value",
      "x".repeat(16001),
      "Bearer fake-sensitive",
      "https://user:fake@proxy.test",
    ])
      assert.throws(() =>
        environmentValue("DEV_FAKE", "", value, "overwrite", "linux"),
      );
    assert.equal(
      environmentValue("DEV_FAKE", "old ", " new ", "append", "linux"),
      "old  new ",
    );
    assert.equal(
      environmentValue("PATH", "C:\\Tools", "C:\\More", "append", "windows"),
      "C:\\Tools;C:\\More",
    );
    assert.equal(
      environmentValue("PATH", "/usr/bin:", "/tools", "append", "macos"),
      "/usr/bin:/tools",
    );
    assert.equal(
      environmentValue("DEV_FAKE", "old", "new", "overwrite", "linux"),
      "new",
    );
  });
  void it(
    "searches bounded names only without executing profiles or returning values",
    unix,
    async () => {
      const path = await home();
      await writeFile(
        join(path, ".profile"),
        "export DEV_PROFILE='fake-private-value'\n",
      );
      const inherited = Object.fromEntries(
        Array.from({ length: 60 }, (_, i) => [
          `DEV_${i}`,
          "fake-private-value",
        ]),
      );
      const environment = new UserEnvironment(
        "linux",
        inherited,
        path,
        "/bin/bash",
      );
      assert.deepEqual(await environment.search(""), []);
      assert.deepEqual(await environment.search("profile"), ["DEV_PROFILE"]);
      const names = await environment.search("dev_");
      assert.equal(names.length, 50);
      assert.doesNotMatch(JSON.stringify(names), /fake-private-value/u);
      await assert.rejects(environment.search("a\nb"));
    },
  );
  void it(
    "persists safely quoted edits, preserves existing files, and appends after restart",
    unix,
    async () => {
      const path = await home(),
        file = join(path, ".profile"),
        original = "# Original\nexport KEEP='safe'\n";
      await writeFile(file, original);
      const environment = new UserEnvironment(
        "linux",
        { DEV_FAKE: "inherited" },
        path,
        "/bin/bash",
      );
      const payload =
        "literal '$HOME' $(touch injected) ; & `backtick` unicode-é";
      const prepared = await environment.prepare(
        "DEV_FAKE",
        payload,
        "overwrite",
      );
      assert.equal(await readFile(file, "utf8"), original);
      await prepared.commit();
      assert.ok((await readFile(file, "utf8")).startsWith(original));
      await (
        await new UserEnvironment("linux", {}, path, "/bin/bash").prepare(
          "DEV_FAKE",
          " more",
          "append",
        )
      ).commit();
      const { stdout } = await promisify(execFile)(
        "/bin/sh",
        ["-c", '. "$1"; printf "%s" "$DEV_FAKE"', "test", file],
        { cwd: path },
      );
      assert.equal(stdout, payload + " more");
      assert.ok(!(await readdir(path)).includes("injected"));
      assert.equal(
        (await readFile(file, "utf8")).split("# DevDashboard user environment:")
          .length,
        2,
      );
      assert.ok(!(await readdir(path)).some((name) => name.endsWith(".tmp")));
    },
  );
  void it(
    "respects startup precedence and refuses unsupported shells, stale writes, damaged blocks and symlinks",
    unix,
    async () => {
      const path = await home(),
        file = join(path, ".profile");
      const environment = new UserEnvironment("linux", {}, path, "/bin/bash");
      await writeFile(file, "# Original\n");
      const prepared = await environment.prepare(
        "DEV_FAKE",
        "safe",
        "overwrite",
      );
      await writeFile(file, "# External edit\n");
      await assert.rejects(prepared.commit(), /changed/u);
      assert.equal(await readFile(file, "utf8"), "# External edit\n");
      await writeFile(
        file,
        "# DevDashboard user environment: DEV_FAKE\nexport DEV_FAKE=$(touch ignored)\n# End DevDashboard user environment: DEV_FAKE\n",
      );
      await assert.rejects(
        environment.prepare("DEV_FAKE", "safe", "append"),
        /invalid/u,
      );
      await rm(file);
      const target = join(path, "dotfiles");
      await writeFile(target, "# Keep\n");
      await symlink(target, file);
      await assert.rejects(
        environment.prepare("DEV_FAKE", "safe", "overwrite"),
        /Symlinks/u,
      );
      assert.equal(await readFile(target, "utf8"), "# Keep\n");
      await rm(file);
      await writeFile(join(path, ".bash_login"), "# Login\n");
      assert.match(
        (await environment.prepare("DEV_FAKE", "safe", "overwrite")).location,
        /\.bash_login/u,
      );
      await writeFile(join(path, ".bash_profile"), "# First\n");
      assert.match(
        (await environment.prepare("DEV_FAKE", "safe", "overwrite")).location,
        /\.bash_profile/u,
      );
      const zsh = new UserEnvironment("macos", {}, path, "/bin/zsh");
      await (await zsh.prepare("DEV_FAKE", "safe", "overwrite")).commit();
      assert.match(
        await readFile(join(path, ".zshenv"), "utf8"),
        /export DEV_FAKE='safe'/u,
      );
      await assert.rejects(
        new UserEnvironment(
          "macos",
          { ZDOTDIR: "/custom" },
          path,
          "/bin/zsh",
        ).prepare("DEV_FAKE", "safe", "overwrite"),
        /ZDOTDIR/u,
      );
      await assert.rejects(
        new UserEnvironment("linux", {}, path, "/bin/fish").prepare(
          "DEV_FAKE",
          "safe",
          "overwrite",
        ),
        /not supported/u,
      );
    },
  );
  void it("uses fixed User registry calls with stdin data, never values in argv", async () => {
    let stored: string | null = "old",
      writes = 0;
    const environment = new UserEnvironment(
      "windows",
      { DEV_FAKE: "fake-private", SystemRoot: "C:\\Windows" },
      "unused",
      "unused",
      (file, args, input) => {
        assert.equal(
          file,
          "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        );
        assert.doesNotMatch(args.join(" "), /fake-private|USER-PAYLOAD/u);
        assert.ok(args.includes("-NoProfile"));
        const request = JSON.parse(input) as {
          action: string;
          value?: string;
          expected?: string | null;
        };
        if (request.action === "names")
          return Promise.resolve(JSON.stringify({ names: ["DEV_FAKE"] }));
        if (request.action === "read")
          return Promise.resolve(JSON.stringify({ value: stored }));
        assert.equal(request.expected, stored);
        writes++;
        stored = request.value!;
        return Promise.resolve(JSON.stringify({ saved: true }));
      },
    );
    assert.deepEqual(await environment.search("dev_"), ["DEV_FAKE"]);
    const prepared = await environment.prepare(
      "DEV_FAKE",
      "USER-PAYLOAD' ; $(anything)",
      "append",
    );
    assert.equal(writes, 0);
    await prepared.commit();
    assert.equal(stored, "oldUSER-PAYLOAD' ; $(anything)");
    assert.match(
      windowsEnvironmentScript,
      /SetEnvironmentVariable\(\$request.name, \$request.value, 'User'\)/u,
    );
    assert.doesNotMatch(
      windowsEnvironmentScript,
      /'Machine'|Invoke-Expression|ExecutionPolicy/u,
    );
  });
});
