import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { systemChromiumExecutable } from "./browser-fixture.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("browser coverage uses the declared local Playwright dependency and no hidden environment", async () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  assert.equal(pkg.devDependencies["playwright-core"], "file:dev-vendor/playwright-core");
  assert.equal(lock.packages["node_modules/playwright-core"].resolved, "dev-vendor/playwright-core");
  assert.equal((await import("playwright-core/package.json", { with: { type: "json" } })).default.version, "1.60.0");
  const sources = ["tests/browser-fixture.ts", "tests/test_review_viewer.test.ts", "tests/test_review_viewer_playwright.test.ts"].map(path => readFileSync(join(root, path), "utf8")).join("\n");
  assert.doesNotMatch(sources, /PLAYWRIGHT_MODULE_PATH|PLAYWRIGHT_CHROMIUM_EXECUTABLE|process\.env\.CHROME|command -v|npm root -g/);
  assert.match(systemChromiumExecutable(), /chromium|chrome/i);
});
