import { readFileSync as readPlatformConfig } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root=join(dirname(fileURLToPath(import.meta.url)),".."),repo=join(root,"..",".."),key=`${process.platform}-${process.arch}`,executable=join(repo,"release-staging",key,"skills","plugin-creator","scripts","plugin-creator"+(process.platform==="win32"?".exe":""));
const NATIVE_SUPPORTED = Object.hasOwn(JSON.parse(readPlatformConfig(new URL("../../../bun-release.json", import.meta.url), "utf8")).targets, process.platform + "-" + process.arch);

test("native plugin-creator CLI is standalone", { skip: !NATIVE_SUPPORTED },()=>{assert.ok(existsSync(executable),`native prerequisite missing: ${executable}`);const run=spawnSync(executable,["--help"],{encoding:"utf8",env:{HOME:root,PATH:"",LANG:"C",LC_ALL:"C"}});assert.ifError(run.error);assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/Usage: plugin-creator/);assert.doesNotMatch(run.stdout+run.stderr,/node_modules|\/$bunfs\//)});
