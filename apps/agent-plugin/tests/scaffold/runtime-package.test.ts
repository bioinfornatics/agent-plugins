import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { startNodeProcess } from "../helpers/subprocess.ts";

const app = fileURLToPath(new URL("../../", import.meta.url));
const names = ["@commander-js/extra-typings", "commander", "yaml"];
async function run(cwd: string, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: cwd, XDG_CONFIG_HOME: cwd, XDG_DATA_HOME: cwd, XDG_STATE_HOME: cwd, PATH: "", NODE_PATH: "", NODE_OPTIONS: "" };
  delete env.NODE_TEST_CONTEXT;
  return await startNodeProcess(args, { cwd, env }).completed;
}
async function fixture(root: string) {
  const source = join(root, "apps/agent-plugin");
  await mkdir(source, { recursive: true });
  await cp(join(app, "../../vendor/agent-plugin-tarballs"), join(root, "vendor/agent-plugin-tarballs"), { recursive: true });
  for (const path of ["src", "scripts/build.mjs", "scripts/package-runtime.mjs", "tsconfig.json", "tsconfig.build.json", "package.json", "package-lock.json"]) {
    await cp(join(app, path), join(source, path), { recursive: true });
  }
  await symlink(join(app, "node_modules"), join(source, "node_modules"), "dir");
  const built = await run(source, "scripts/build.mjs");
  assert.strictEqual(built.exitCode, 0, built.stdout + built.stderr);
  await rm(join(source, "node_modules"));
  for (const name of names) await cp(join(app, "node_modules", name), join(source, "node_modules", name), { recursive: true });
  return source;
}

test("fresh contained package has exact locked closure/hashes/licenses and runs help/dry-run/read-only history outside repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-plugin-package-"));
  try {
    const source = await fixture(root);
    const skill = join(root, "installed skill");
    const packaged = await run(source, "scripts/package-runtime.mjs", skill);
    assert.strictEqual(packaged.exitCode, 0, packaged.stderr);
    const manifest = JSON.parse(await readFile(join(skill, "runtime/runtime-manifest.json"), "utf8"));
    const lockBytes = await readFile(join(source, "package-lock.json"));
    const lock = JSON.parse(lockBytes.toString());
    assert.strictEqual(manifest.sourceLock.sha256, createHash("sha256").update(lockBytes).digest("hex"));
    assert.deepStrictEqual(manifest.productionDependencies, names.map(name => ({ name, version: lock.packages[`node_modules/${name}`].version, integrity: lock.packages[`node_modules/${name}`].integrity })));
    assert.strictEqual(manifest.app, "apps/agent-plugin");
    assert.strictEqual(manifest.runtimeEntry, "dist/index.js");
    assert.strictEqual(manifest.node, ">=22.22.2");
    assert.deepStrictEqual(await readdir(join(skill, "runtime/node_modules")), ["@commander-js", "commander", "yaml"]);
    for (const file of manifest.files) {
      const bytes = await readFile(join(skill, "runtime", file.path));
      assert.strictEqual((await lstat(join(skill, "runtime", file.path))).isSymbolicLink(), false);
      assert.strictEqual(file.size, bytes.length);
      assert.strictEqual(file.sha256, createHash("sha256").update(bytes).digest("hex"));
      assert.doesNotMatch(file.path, /\.(ts|map|node)$/);
    }
    for (const name of names) assert.ok(manifest.files.some((file: { path: string }) => file.path.startsWith(`node_modules/${name}/`) && /LICENSE/.test(file.path)));
    const again = await run(source, "scripts/package-runtime.mjs", skill);
    assert.notStrictEqual(again.exitCode, 0);
    await rm(source, { recursive: true });
    const launch = join(skill, "scripts/skill-creator.mjs");
    const help = await run(root, launch, "--help");
    assert.strictEqual(help.exitCode, 0, help.stderr);
    assert.match(help.stdout, /Usage: agent-plugin/);
    assert.strictEqual(help.stderr, "");
    assert.deepStrictEqual(await run(root, launch, "--unknown"), { exitCode: 1, signal: null, stdout: "", stderr: "error: unknown option '--unknown'\n" });
    const input = join(root, "inputs with spaces", "sample");
    await mkdir(join(input, "evals"), { recursive: true });
    await writeFile(join(input, "SKILL.md"), "---\nname: sample\ndescription: Test\n---\n");
    await writeFile(join(input, "evals/evals.json"), JSON.stringify({ evals: [{ id: 1, prompt: "Exact prompt", expectations: ["Exact criterion"] }] }));
    const dry = await run(root, launch, "evaluation", "--skills", input, "--dry-run");
    assert.strictEqual(dry.exitCode, 0, dry.stderr);
    assert.strictEqual(dry.stderr, "");
    const plan = JSON.parse(dry.stdout);
    assert.strictEqual(plan.status, "prepared");
    assert.strictEqual(plan.candidateRuns, 6);
    assert.strictEqual(plan.profile.scenarios[0].prompt, "Exact prompt");
    assert.deepStrictEqual(plan.profile.scenarios[0].expectations, ["Exact criterion"]);
    const registry = join(root, "never-created.sqlite");
    const history = await run(root, launch, "history", "--registry", registry, "--json");
    assert.strictEqual(history.exitCode, 0, history.stderr);
    assert.ok(!((await readdir(root)).includes("never-created.sqlite")));
    const manifestPath = join(skill, "runtime/runtime-manifest.json");
    for (const entry of ["../outside.js", "/tmp/outside.js", "dist//index.js", "dist/./index.js", "dist\\index.js", "dist/main.js"]) {
      await writeFile(manifestPath, JSON.stringify({ ...manifest, runtimeEntry: entry }));
      const failed = await run(root, launch, "--help");
      assert.strictEqual(failed.exitCode, 1);
      assert.strictEqual(failed.stdout, "");
      assert.match(failed.stderr, /invalid runtime manifest/);
    }
    await writeFile(manifestPath, "{broken");
    assert.strictEqual((await run(root, launch, "--help")).exitCode, 1);
    await writeFile(manifestPath, JSON.stringify(manifest));
    // A nested commander would win Node resolution while all listed hashes remain valid.
    const injected = join(skill, "runtime/dist/node_modules/commander");
    await mkdir(injected, { recursive: true });
    await writeFile(join(injected, "package.json"), '{"name":"commander","type":"module","main":"index.js"}');
    await writeFile(join(injected, "index.js"), "console.log('INJECTED SUCCESS'); process.exit(0);\n");
    for (const file of manifest.files) {
      const bytes = await readFile(join(skill, "runtime", file.path));
      assert.strictEqual(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    }
    const injection = await run(root, launch, "--help");
    assert.strictEqual(injection.exitCode, 1);
    assert.strictEqual(injection.stdout, "");
    assert.match(injection.stderr, /unlisted runtime directory/);
    await rm(join(injected, ".."), { recursive: true });
    const extra = join(skill, "runtime/dist/extra.js");
    await writeFile(extra, "console.log('INJECTED SUCCESS');");
    assert.match((await run(root, launch, "--help")).stderr, /unlisted runtime file/);
    await rm(extra);
    await symlink(join(skill, "runtime/dist/index.js"), extra);
    const extraLink = await run(root, launch, "--help");
    assert.strictEqual(extraLink.exitCode, 1);
    assert.strictEqual(extraLink.stdout, "");
    assert.match(extraLink.stderr, /symlink is forbidden/);
    await rm(extra);
    await mkdir(join(skill, "runtime/dist/node_modules"));
    assert.match((await run(root, launch, "--help")).stderr, /unlisted runtime directory/);
    await rm(join(skill, "runtime/dist/node_modules"), { recursive: true });
    await cp(join(skill, "runtime/dist"), join(root, "escaped-dist"), { recursive: true });
    await rm(join(skill, "runtime/dist"), { recursive: true });
    await symlink(join(root, "escaped-dist"), join(skill, "runtime/dist"), "dir");
    assert.match((await run(root, launch, "--help")).stderr, /symlink is forbidden/);
    await rm(join(skill, "runtime/dist"));
    await cp(join(root, "escaped-dist"), join(skill, "runtime/dist"), { recursive: true });
    await rm(join(skill, "runtime/node_modules/commander"), { recursive: true });
    const missing = await run(root, launch, "--help");
    assert.strictEqual(missing.exitCode, 1);
    assert.strictEqual(missing.stdout, "");
    assert.match(missing.stderr, /ENOENT/);
    await cp(join(app, "node_modules/commander"), join(skill, "runtime/node_modules/commander"), { recursive: true });
    await writeFile(join(skill, "runtime/node_modules/commander/index.js"), "tampered");
    assert.match((await run(root, launch, "--help")).stderr, /runtime integrity mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("packaging refuses mismatched identities, symlinks, native addons and install lifecycle dependencies before creating destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-plugin-package-refusal-"));
  try {
    const source = await fixture(root);
    const destination = join(root, "output");
    const packagePath = join(source, "node_modules/commander/package.json");
    const original = await readFile(packagePath, "utf8");
    for (const patch of [{ version: "0.0.0" }, { scripts: { install: "malicious" } }]) {
      await writeFile(packagePath, JSON.stringify({ ...JSON.parse(original), ...patch }));
      const failed = await run(source, "scripts/package-runtime.mjs", destination);
      assert.strictEqual(failed.exitCode, 1);
      assert.match(failed.stderr, /Unsafe or mismatched/);
      assert.ok(!(await readdir(root)).includes("output"));
    }
    await writeFile(packagePath, original);
    await writeFile(join(source, "node_modules/commander/addon.node"), "native");
    assert.match((await run(source, "scripts/package-runtime.mjs", destination)).stderr, /Native addon/);
    await rm(join(source, "node_modules/commander/addon.node"));
    await symlink(packagePath, join(source, "node_modules/commander/link"));
    assert.match((await run(source, "scripts/package-runtime.mjs", destination)).stderr, /Symlink/);
    await rm(join(source, "node_modules/commander/link"));
    const codePath = join(source, "node_modules/commander/index.js");
    const code = await readFile(codePath);
    await writeFile(codePath, "console.log('INJECTED SUCCESS'); process.exit(0);\n");
    const altered = await run(source, "scripts/package-runtime.mjs", destination);
    assert.strictEqual(altered.exitCode, 1);
    assert.strictEqual(altered.stdout, "");
    assert.match(altered.stderr, /Installed package bytes mismatch/);
    assert.ok(!(await readdir(root)).includes("output"));
    await writeFile(codePath, code);
    const extra = join(source, "node_modules/commander/extra.js");
    await writeFile(extra, "extra");
    assert.match((await run(source, "scripts/package-runtime.mjs", destination)).stderr, /Installed package inventory mismatch/);
    await rm(extra);
    const tarball = join(root, "vendor/agent-plugin-tarballs/commander-15.0.0.tgz");
    const archive = await readFile(tarball);
    await writeFile(tarball, Buffer.concat([archive, Buffer.from("tampered")]));
    assert.match((await run(source, "scripts/package-runtime.mjs", destination)).stderr, /Vendor tarball integrity mismatch/);
    await writeFile(tarball, archive);
    const lockPath = join(source, "package-lock.json");
    const lockBytes = await readFile(lockPath);
    const lock = JSON.parse(lockBytes.toString());
    // Even a lock-authenticated archive must not grant links filesystem authority.
    const vendorPath = join(root, "vendor/agent-plugin-tarballs/manifest.json");
    const vendorBytes = await readFile(vendorPath);
    const vendor = JSON.parse(vendorBytes.toString());
    const unsafe = gunzipSync(archive);
    unsafe[156] = 50; // tar symlink type; header checksum remains valid.
    unsafe.fill(32, 148, 156);
    const checksum = unsafe.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
    unsafe.write(`${checksum.toString(8).padStart(6, "0")} \0`, 148, "ascii");
    const unsafeArchive = gzipSync(unsafe);
    const integrity = `sha512-${createHash("sha512").update(unsafeArchive).digest("base64")}`;
    lock.packages["node_modules/commander"].integrity = integrity;
    vendor.packages.find((entry: { name: string }) => entry.name === "commander").integrity = integrity;
    await writeFile(lockPath, JSON.stringify(lock));
    await writeFile(vendorPath, JSON.stringify(vendor));
    await writeFile(tarball, unsafeArchive);
    const unsupported = await run(source, "scripts/package-runtime.mjs", destination);
    assert.strictEqual(unsupported.exitCode, 1);
    assert.strictEqual(unsupported.stdout, "");
    assert.match(unsupported.stderr, /Unsafe or unsupported tar entry/);
    assert.ok(!(await readdir(root)).includes("output"));
    await writeFile(tarball, archive);
    await writeFile(vendorPath, vendorBytes);
    await writeFile(lockPath, lockBytes);
    lock.packages["node_modules/commander"].integrity = JSON.parse(lockBytes.toString()).packages["node_modules/commander"].integrity;
    lock.packages["node_modules/unexpected"] = { version: "1.0.0" };
    await writeFile(lockPath, JSON.stringify(lock));
    assert.match((await run(source, "scripts/package-runtime.mjs", destination)).stderr, /Lock production closure mismatch/);
    delete lock.packages["node_modules/unexpected"];
    lock.packages[""].name = "other";
    await writeFile(lockPath, JSON.stringify(lock));
    assert.match((await run(source, "scripts/package-runtime.mjs", destination)).stderr, /identity mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("launcher enforces exact Node floor and preserves argv, both streams, exit codes and child signals", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-plugin-launch-contract-"));
  try {
    const source = await fixture(root);
    const skill = join(root, "skill");
    assert.strictEqual((await run(source, "scripts/package-runtime.mjs", skill)).exitCode, 0);
    await rm(source, { recursive: true });
    const launcher = join(skill, "scripts/skill-creator.mjs");
    for (const version of ["21.99.99", "22.21.99", "22.22.1"]) {
      const rejected = await run(root, "--input-type=module", "--eval", `Object.defineProperty(process.versions, 'node', {value: '${version}'}); await import(${JSON.stringify(launcher)});`);
      assert.strictEqual(rejected.exitCode, 1);
      assert.strictEqual(rejected.stdout, "");
      assert.match(rejected.stderr, /Node.js >=22.22.2 is required/);
    }
    for (const version of ["22.22.2", "22.23.0", "23.0.0"]) {
      const accepted = await run(root, "--input-type=module", "--eval", `Object.defineProperty(process.versions, 'node', {value: '${version}'}); process.argv = ['node', 'launcher', '--help']; await import(${JSON.stringify(launcher)});`);
      assert.strictEqual(accepted.exitCode, 0, accepted.stderr);
      assert.match(accepted.stdout, /Usage: agent-plugin/);
    }
    // Controlled emitted fixture proves process transport, not host/model compatibility.
    const manifestPath = join(skill, "runtime/runtime-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    async function replaceEntry(code: string) {
      await writeFile(join(skill, "runtime/dist/index.js"), code);
      const entry = manifest.files.find((file: { path: string }) => file.path === "dist/index.js");
      entry.size = Buffer.byteLength(code);
      entry.sha256 = createHash("sha256").update(code).digest("hex");
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    await replaceEntry("process.stdout.write(JSON.stringify(process.argv.slice(2))); process.stderr.write('diagnostic'); process.exitCode = 17;\n");
    assert.deepStrictEqual(await run(root, launcher, "with spaces", "$(not-shell)", "--flag"), {
      exitCode: 17, signal: null, stdout: JSON.stringify(["with spaces", "$(not-shell)", "--flag"]), stderr: "diagnostic",
    });
    if (process.platform !== "win32") {
      await replaceEntry("process.stdout.write('before signal'); process.kill(process.pid, 'SIGTERM');\n");
      assert.deepStrictEqual(await run(root, launcher), { exitCode: null, signal: "SIGTERM", stdout: "before signal", stderr: "" });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Real emitted CLI + SQLite proves installed orchestration, not native/model compatibility.
test("contained launcher executes a fake Goose pair, inspects attributed attempts and resumes frozen completion without new candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-plugin-installed-campaign-"));
  try {
    const source = await fixture(root);
    const skill = join(root, "installed skill");
    assert.strictEqual((await run(source, "scripts/package-runtime.mjs", skill)).exitCode, 0);
    await rm(source, { recursive: true });
    assert.ok(!(await readdir(join(root, "apps"))).includes("agent-plugin"));
    assert.ok(!(await readdir(join(skill, "runtime"))).includes("src"));
    const launcher = join(skill, "scripts/skill-creator.mjs");
    const home = join(root, "private home"), bin = join(root, "bin"), config = join(home, "config");
    await mkdir(config, { recursive: true });
    await mkdir(bin);
    const configuration = "GOOSE_MODEL: fake\nextensions: {}\n";
    await writeFile(join(config, "config.yaml"), configuration);
    const callsPath = join(root, "fake-calls.jsonl");
    await writeFile(callsPath, "");
    await writeFile(join(bin, "goose"), `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2), base = process.env.GOOSE_PATH_ROOT;
const config = base ? join(base, 'config') : ${JSON.stringify(config)};
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');
if (args[0] === 'info') console.log('Version: 1.57.0\\nConfig dir: ' + config + '\\nConfig yaml: ' + join(config, 'config.yaml') + '\\nSessions DB (sqlite): ' + join(base || config, 'data', 'sessions.db') + '\\nLogs dir: ' + join(base || config, 'state', 'logs'));
else if (args.includes('--help')) console.log('--instructions --name --max-turns --quiet --output-format --model stream-json --format json');
else if (args[0] === 'run') {
  if (!base || !process.env.HOME.startsWith(${JSON.stringify(root)})) throw Error('nonprivate candidate');
  const prompt = readFileSync(0, 'utf8'), target = join(process.env.HOME, '.agents', 'skills', 'sample');
  if (prompt !== 'Installed task' || existsSync(join(target, 'evals'))) throw Error('invalid treatment');
  if (args[args.indexOf('--max-turns') + 1] !== '5') throw Error('lost options');
  const name = args[args.indexOf('--name') + 1];
  writeFileSync(join(base, 'run-name'), name);
  writeFileSync('result.json', JSON.stringify({ prompt, withTarget: existsSync(target), home: process.env.HOME }));
  console.log(JSON.stringify({ type: 'message', text: 'fake candidate output' }));
  console.error('fake diagnostic');
} else if (args[0] === 'session') {
  if (readFileSync(join(base, 'run-name'), 'utf8') !== args[args.indexOf('--name') + 1]) throw Error('wrong session');
  console.log(JSON.stringify({ messages: [{ role: 'user', content: 'Installed task' }, { role: 'assistant', content: 'fake candidate output' }] }));
} else throw Error('unsupported fake command');
`, { mode: 0o700 });
    // Explicit environment: no operator credentials/config or live HOME reaches this CLI.
    const env: NodeJS.ProcessEnv = {
      HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: config, XDG_DATA_HOME: join(home, "data"),
      XDG_STATE_HOME: join(home, "state"), XDG_CACHE_HOME: join(home, "cache"), TMPDIR: root,
      PATH: bin, NODE_PATH: "", NODE_OPTIONS: "", GOOSE_DISABLE_KEYRING: "true",
    };
    async function launch(...args: string[]) {
      const result = await startNodeProcess([launcher, ...args], { cwd: root, env }).completed;
      assert.strictEqual(result.signal, null, result.stderr);
      assert.strictEqual(result.exitCode, 0, result.stdout + result.stderr);
      assert.doesNotMatch(result.stderr, /error:|Unexpected CLI failure/);
      return JSON.parse(result.stdout);
    }
    const calls = async (): Promise<string[][]> => (await readFile(callsPath, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    const input = join(root, "input", "sample");
    await mkdir(join(input, "evals"), { recursive: true });
    await writeFile(join(input, "SKILL.md"), "---\nname: sample\ndescription: Test\n---\n");
    await writeFile(join(input, "evals/evals.json"), JSON.stringify({ evals: [{ id: 1, prompt: "Installed task", expectations: ["Private criterion"] }] }));
    const registry = join(root, "registry", "evaluation.sqlite");
    const options = ["evaluation", "--skills", input, "--repetitions", "1", "--max-turns", "5", "--parallelism", "2", "--registry", registry, "--output", join(root, "evidence")];
    const prepared = await launch(...options, "--dry-run");
    assert.strictEqual(prepared.candidateRuns, 2);
    assert.deepStrictEqual(await calls(), []);
    assert.ok(!(await readdir(root)).includes("registry"));
    const campaign = await launch(...options);
    assert.deepStrictEqual([campaign.completed, campaign.failed, campaign.total, campaign.registry], [2, 0, 2, registry]);
    const completedCalls = await calls();
    assert.strictEqual(completedCalls.filter(args => args[0] === "run" && !args.includes("--help")).length, 2);
    const database = await readFile(registry);
    const inspected = await launch("inspect", campaign.id, "--registry", registry, "--json");
    assert.deepStrictEqual(await readFile(registry), database);
    assert.deepStrictEqual(await calls(), completedCalls);
    assert.deepStrictEqual([inspected.id, inspected.total, inspected.finalized, inspected.uncertain, inspected.score], [campaign.id, 2, 2, 0, null]);
    assert.strictEqual(inspected.revision, prepared.profile.revision);
    assert.strictEqual(inspected.profileId, prepared.profile.id);
    assert.strictEqual(inspected.options.maxTurns, 5);
    assert.strictEqual(inspected.attempts.length, 2);
    assert.deepStrictEqual(inspected.trials.map((trial: { status: string }) => trial.status), ["finalized", "finalized"]);
    const sessions = new Set<string>();
    for (const attempt of inspected.attempts) {
      assert.strictEqual(attempt.status, "completed");
      assert.strictEqual(attempt.collection, "complete");
      assert.strictEqual(attempt.scenario, prepared.profile.scenarios[0].id);
      assert.deepStrictEqual(attempt.receipt.host, { id: "goose", version: "1.57.0" });
      assert.strictEqual(attempt.receipt.exitCode, 0);
      sessions.add(attempt.receipt.sessionName);
      assert.ok(inspected.trials.some((trial: { id: string; attemptId: string }) => trial.id === attempt.trialId && trial.attemptId === attempt.id));
      for (const evidence of attempt.evidence) {
        assert.strictEqual(evidence.available, true);
        assert.ok(evidence.path.startsWith(join(campaign.output, "artifacts", attempt.id)));
        const bytes = await readFile(evidence.path);
        assert.strictEqual(bytes.length, evidence.bytes);
        assert.strictEqual(createHash("sha256").update(bytes).digest("hex"), evidence.sha256);
      }
      const artifactRoot = join(campaign.output, "artifacts", attempt.id);
      assert.strictEqual(await readFile(join(artifactRoot, "goose/stderr.log"), "utf8"), "fake diagnostic\n");
      assert.strictEqual(await readFile(join(artifactRoot, "goose/stream.jsonl"), "utf8"), `${JSON.stringify({ type: "message", text: "fake candidate output" })}\n`);
      const result = JSON.parse(await readFile(join(artifactRoot, "workspace/result.json"), "utf8"));
      assert.deepStrictEqual([result.prompt, result.withTarget], ["Installed task", attempt.condition === "with"]);
    }
    assert.deepStrictEqual(inspected.attempts.map((attempt: { condition: string }) => attempt.condition).sort(), ["with", "without"]);
    assert.strictEqual(sessions.size, 2);
    await rm(input, { recursive: true });
    const resumed = await launch("evaluation", "--resume", campaign.id, "--registry", registry);
    assert.deepStrictEqual(resumed, campaign);
    // Completed resume still probes host support, but must never run/export a new candidate.
    assert.deepStrictEqual((await calls()).filter(args => !args.includes("--help") && ["run", "session"].includes(args[0] ?? "")), completedCalls.filter(args => !args.includes("--help") && ["run", "session"].includes(args[0] ?? "")));
    assert.deepStrictEqual(await launch("inspect", campaign.id, "--registry", registry, "--json"), inspected);
    assert.strictEqual(await readFile(join(config, "config.yaml"), "utf8"), configuration);
  } finally { await rm(root, { recursive: true, force: true }); }
});
