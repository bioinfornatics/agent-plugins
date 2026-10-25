import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dir, "..");
const workflowPath = join(root, ".github", "workflows", "bun-release-build.yml");
const source = readFileSync(workflowPath, "utf8");
const workflow = Bun.YAML.parse(source) as Record<string, any>;
const build = workflow.jobs.build;
const publish = workflow.jobs.publish;
const entries = build.strategy.matrix.include as Array<Record<string, string>>;
const temporaryDirectories: string[] = [];

const expectedReleaseKeys = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];
const expectedRunnerByReleaseKey: Record<string, string> = {
  "linux-x64": "ubuntu-24.04",
  "linux-arm64": "ubuntu-24.04-arm",
  "darwin-x64": "macos-15-intel",
  "darwin-arm64": "macos-15-arm64",
  "win32-x64": "windows-2025",
};
const expectedTargetByReleaseKey: Record<string, string> = {
  "linux-x64": "bun-linux-x64-baseline",
  "linux-arm64": "bun-linux-arm64",
  "darwin-x64": "bun-darwin-x64",
  "darwin-arm64": "bun-darwin-arm64",
  "win32-x64": "bun-windows-x64-baseline",
};
const expectedNativePlatformByReleaseKey: Record<string, [string, string]> = {
  "linux-x64": ["linux", "x64"],
  "linux-arm64": ["linux", "arm64"],
  "darwin-x64": ["darwin", "x64"],
  "darwin-arm64": ["darwin", "arm64"],
  "win32-x64": ["win32", "x64"],
};

function actionSteps(job: Record<string, any>) {
  return (job.steps as Array<Record<string, any>>).filter((step) => step.uses);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("tag release build workflow", () => {
  test("parses and declares the complete pinned native matrix", () => {
    expect(workflow.on.push.tags).toEqual(["v*"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(entries.map((entry) => entry["release-key"])).toEqual(expectedReleaseKeys);
    for (const entry of entries) {
      const releaseKey = entry["release-key"];
      expect(entry.runner).toBe(expectedRunnerByReleaseKey[releaseKey]);
      expect(entry["bun-target"]).toBe(expectedTargetByReleaseKey[releaseKey]);
      expect([entry["expected-platform"], entry["expected-arch"]]).toEqual(expectedNativePlatformByReleaseKey[releaseKey]);
    }
    expect(build["runs-on"]).toBe("${{ matrix.runner }}");
    expect(build.strategy["fail-fast"]).toBe(false);
  });

  test("pins Bun and every third-party action to immutable revisions", () => {
    expect(build.steps.find((step: any) => step.uses?.startsWith("oven-sh/setup-bun@"))?.with?.["bun-version"]).toBe("1.3.12");
    for (const step of [...actionSteps(build), ...actionSteps(publish)]) {
      expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/);
    }
  });

  test("guards native execution, tests it, then uploads a collision-free artifact", () => {
    const steps = build.steps as Array<Record<string, any>>;
    const guard = steps.find((step) => step.name === "Assert native target runner");
    const buildStep = steps.find((step) => step.name === "Build target executables");
    const smoke = steps.find((step) => step.name === "Smoke-test native executables");
    const packageTest = steps.find((step) => step.name === "Package and execute the Skill Creator release artifact");
    const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(guard.run).toContain("process.platform !== platform || process.arch !== arch");
    expect(buildStep.run).toContain("--target=${{ matrix.bun-target }}");
    expect(smoke.run).toBe("node --test tests/test_bun_executables.test.ts");
    expect(packageTest.run).toBe("node --test apps/skill-creator-cli/tests/test_package_skill.test.ts");
    expect(steps.indexOf(packageTest)).toBeGreaterThan(steps.indexOf(buildStep));
    expect(steps.indexOf(upload)).toBeGreaterThan(steps.indexOf(packageTest));
    expect(upload.with.name).toBe("creators-${{ matrix.release-key }}-${{ github.sha }}-${{ github.run_attempt }}");
    expect(upload.with.path.trim()).not.toBe("");
    expect(upload.with.path).toBe("release-staging/${{ matrix.release-key }}/");
    expect(upload.with.path).not.toBe("bin/");
    expect(upload.with["if-no-files-found"]).toBe("error");
    expect(upload.with["retention-days"]).toBe(14);
  });

  test("fans in all builds and grants write permission only to publication", () => {
    expect(publish.needs).toEqual(["build"]);
    expect(build.permissions).toBeUndefined();
    expect(publish.permissions).toEqual({ contents: "write" });
    const download = publish.steps.find((step: any) => step.uses?.startsWith("actions/download-artifact@"));
    expect(download.with.pattern).toBe("creators-*-${{ github.sha }}-${{ github.run_attempt }}");
    expect(download.with.path).toBe("release-input");
  });

  test("checks existing releases, stages a draft, and publishes only after every asset uploads", () => {
    const steps = publish.steps as Array<Record<string, any>>;
    const packageIndex = steps.findIndex((step) => step.name === "Create deterministic archives and checksums");
    const refuseIndex = steps.findIndex((step) => step.name === "Refuse to replace an existing release");
    const createIndex = steps.findIndex((step) => step.name === "Create draft release with all verified assets");
    const publishIndex = steps.findIndex((step) => step.name === "Publish the complete draft release");
    expect(steps[packageIndex].run).toContain("package-bun-release-assets.mjs");
    expect(steps[refuseIndex].run).toContain("gh release view");
    expect(steps[refuseIndex].run).toContain("refusing to replace");
    expect(steps[createIndex].run).toContain("release-assets/*");
    expect(steps[createIndex].run).toContain("--draft");
    expect(steps[createIndex].run).toContain("--verify-tag");
    expect(steps[createIndex].run).toContain("--notes-file RELEASES.md");
    expect(steps[publishIndex].run).toContain("--draft=false");
    expect(packageIndex).toBeLessThan(refuseIndex);
    expect(refuseIndex).toBeLessThan(createIndex);
    expect(createIndex).toBeLessThan(publishIndex);
    expect(source).not.toContain("--clobber");
  });
});

describe("release asset documentation", () => {
  test("maps every supported OS and architecture to its asset and explains verification", () => {
    const documentation = readFileSync(join(root, "RELEASES.md"), "utf8");
    for (const releaseKey of expectedReleaseKeys) {
      expect(documentation).toContain(`agent-plugins-creators-${releaseKey}.tar.gz`);
    }
    expect(documentation).toContain("sha256sum --ignore-missing -c SHA256SUMS");
    expect(documentation).toContain("shasum -a 256 -c -");
    expect(documentation).toContain("Get-FileHash");
    expect(documentation).toContain("refuses to overwrite");
  });
});

