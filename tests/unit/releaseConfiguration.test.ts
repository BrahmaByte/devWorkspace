import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");
const packageIgnore = readFileSync(".vscodeignore", "utf8");
const identityWorkflow = readFileSync(
  ".github/workflows/marketplace-identity.yml",
  "utf8",
);
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  readonly scripts: Readonly<Record<string, string>>;
  readonly version: string;
};
const lockfile = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
  readonly version: string;
  readonly packages: Readonly<Record<string, { readonly version?: string }>>;
};

void describe("Release validation configuration", () => {
  void it("keeps source line endings consistent in Windows checkouts", () => {
    assert.match(
      readFileSync(".gitattributes", "utf8"),
      /^\* text=auto eol=lf/mu,
    );
  });
  void it("does not require ignored local documentation in a fresh checkout", () => {
    assert.doesNotMatch(
      manifest.scripts["format:check"] ?? "",
      /docs\/\*\*\/\*\.md/u,
    );
    assert.doesNotMatch(manifest.scripts.format ?? "", /docs\/\*\*\/\*\.md/u);
  });
  void it("accepts the exact release version and rejects invalid or mismatched tags", () => {
    for (const tag of [
      `v${manifest.version}`,
      "main",
      "v0.0.0",
      "v1.2.3;echo unsafe",
    ]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/verify-release.mjs", tag],
        { encoding: "utf8" },
      );
      assert.equal(result.status === 0, tag === `v${manifest.version}`);
    }
  });

  void it("gates releases on all validation targets and verifies exact publication artifacts", () => {
    assert.match(releaseWorkflow, /uses: \.\/\.github\/workflows\/ci\.yml/u);
    assert.match(releaseWorkflow, /needs: validate/u);
    assert.match(releaseWorkflow, /--githubBranch/u);
    assert.match(releaseWorkflow, /--check-public-images/u);
    assert.match(releaseWorkflow, /sha256sum --check SHA256SUMS\.txt/u);
    assert.match(releaseWorkflow, /--verify-tag/u);
    assert.match(releaseWorkflow, /environment: marketplace/u);
    assert.match(
      releaseWorkflow,
      /vsce publish --azure-credential --packagePath/u,
    );
    assert.doesNotMatch(releaseWorkflow, /pull_request_target/u);
  });
  void it("uses environment-protected OIDC without publishing secrets or CI identity access", () => {
    const [nonPublishingJobs, marketplaceJob] =
      releaseWorkflow.split("\n  marketplace:");
    assert.doesNotMatch(nonPublishingJobs ?? "", /id-token: write/u);
    assert.match(marketplaceJob ?? "", /id-token: write/u);
    assert.doesNotMatch(workflow, /id-token: write/u);
    for (const publishingWorkflow of [releaseWorkflow, identityWorkflow]) {
      assert.match(publishingWorkflow, /environment: marketplace/u);
      assert.match(publishingWorkflow, /uses: azure\/login@v3/u);
      assert.match(publishingWorkflow, /vars\.AZURE_CLIENT_ID/u);
      assert.match(publishingWorkflow, /vars\.AZURE_TENANT_ID/u);
      assert.match(publishingWorkflow, /allow-no-subscriptions: true/u);
      assert.doesNotMatch(
        publishingWorkflow,
        /VSCE_PAT|AZURE_CLIENT_SECRET|secrets\.|pull_request_target/u,
      );
    }
    assert.match(identityWorkflow, /workflow_dispatch:/u);
    assert.doesNotMatch(identityWorkflow, /vsce publish|gh release|push:/u);
    assert.match(identityWorkflow, /--query id --output tsv/u);
    assert.match(identityWorkflow, /499b84ac-1321-427f-aa17-267ca6975798/u);
    assert.match(identityWorkflow, /GITHUB_STEP_SUMMARY/u);
    assert.doesNotMatch(identityWorkflow, /get-access-token|Authorization/u);
  });
  void it("pins all supported operating-system and architecture targets", () => {
    for (const target of [
      ["windows-2025", "win32", "x64"],
      ["macos-15-intel", "darwin", "x64"],
      ["macos-15", "darwin", "arm64"],
      ["ubuntu-24.04", "linux", "x64"],
    ]) {
      for (const value of target)
        assert.match(workflow, new RegExp(value, "u"));
    }
    assert.doesNotMatch(workflow, /(?:windows|macos|ubuntu)-latest/u);
  });

  void it("verifies the runner, validates, packages, and retains each VSIX", () => {
    assert.match(workflow, /scripts\/verify-release-target\.mjs/u);
    assert.match(workflow, /run: npm run validate/u);
    assert.match(workflow, /actions\/upload-artifact@v4/u);
    assert.match(workflow, /path: devdashboardv1\.vsix/u);
  });

  void it("identifies a Marketplace-compatible release and verifies the packaged archive", () => {
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/u);
    assert.equal(lockfile.version, manifest.version);
    assert.equal(lockfile.packages[""]?.version, manifest.version);
    assert.match(manifest.scripts.validate ?? "", /npm run verify:vsix/u);
    assert.match(
      manifest.scripts["verify:vsix"] ?? "",
      /scripts\/verify-vsix\.mjs/u,
    );
    for (const pattern of [
      "node_modules/**/*.md",
      "node_modules/**/*.ts",
      "node_modules/**/*.map",
    ])
      assert.ok(
        packageIgnore.split("\n").includes(pattern),
        `Package ignore must exclude ${pattern}`,
      );
  });
});
