#!/usr/bin/env node
// Validate the hook component of a Goose/Open Plugins plugin.
import { realpathSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_HOOKS_PATH, locateHooks, validateHooks, type ValidationResult } from "./hook_format.js";

export interface ValidateResult extends ValidationResult { path: string; }

export function validateHook(pluginDir: string): ValidateResult {
  const root = resolve(pluginDir);
  const result = validateHooks(root);
  const located = locateHooks(root);
  return { ...result, path: located.path ?? join(root, ...CANONICAL_HOOKS_PATH.split("/")) };
}

function isMain(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  try { return realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(process.argv[1])); } catch { return false; }
}

function legacyMain(): void {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("usage: validate_hook.js <plugin_dir>");
    process.exitCode = 2;
    return;
  }
  const result = validateHook(args[0]);
  for (const warning of result.warnings) console.log(`WARNING: ${warning}`);
  if (result.errors.length) {
    for (const error of result.errors) console.log(`ERROR: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK: ${result.path}`);
}

if (isMain(import.meta.url)) legacyMain();
