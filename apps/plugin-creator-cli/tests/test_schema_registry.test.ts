import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  DEFAULT_SCHEMA_VERSION,
  SCHEMA_VERSION_REGISTRY,
  findSchemaIdentifier,
  getActiveSchemaVersions,
  getDefaultSchemaVersion,
  getSchemaPath,
} from "../dist/scripts/schema_registry.js";

test("defaults to the published and active 1.0.0 schemas", () => {
  const entry = getDefaultSchemaVersion();
  assert.equal(DEFAULT_SCHEMA_VERSION, "1.0.0");
  assert.equal(entry, SCHEMA_VERSION_REGISTRY["1.0.0"]);
  assert.equal(entry.status, "published");
  assert.equal(entry.activeForValidation, true);
  assert.equal(entry.activeForGeneration, true);
  assert.deepEqual(getActiveSchemaVersions().map(item => item.version), ["1.0.0"]);
  assert.ok(existsSync(getSchemaPath(entry, "manifest")));
  assert.ok(existsSync(getSchemaPath(entry, "mcp")));
});

test("recognizes 1.1.0 as draft metadata without activating it", () => {
  const draft = SCHEMA_VERSION_REGISTRY["1.1.0"];
  assert.equal(draft.status, "draft");
  assert.equal(draft.activeForValidation, false);
  assert.equal(draft.activeForGeneration, false);
  const found = findSchemaIdentifier(draft.schemas.manifest.id);
  assert.equal(found?.version, draft);
  assert.equal(found?.type, "manifest");
});

test("does not infer or fetch unknown schema identifiers", () => {
  assert.equal(findSchemaIdentifier("https://agent-plugins.org/schemas/9.9.9/plugin.schema.json"), undefined);
  assert.equal(findSchemaIdentifier("https://example.test/plugin.schema.json"), undefined);
});
