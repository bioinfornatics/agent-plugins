import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GOOSE = process.env.GOOSE_EXECUTABLE || "goose";
const gooseVersion = spawnSync(GOOSE, ["--version"], { encoding: "utf8" });
const hasVerifiedGoose = gooseVersion.status === 0 && /1\.47\.0\b/.test(`${gooseVersion.stdout}${gooseVersion.stderr}`);
const names = ["agent-creator", "hook-creator", "plugin-creator", "skill-creator"];

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 120_000 });
}

test("Goose 1.47 installs and updates the real Git candidate in an isolated path root", { skip: hasVerifiedGoose ? false : "requires Goose 1.47.0", timeout: 180_000 }, () => {
  const temp = mkdtempSync(join(tmpdir(), "goose-1.47-git-install "));
  try {
    const archive = join(temp, "candidate.tar"), index = join(temp, "candidate.index");
    const gitEnv = { ...process.env, HOME: join(temp, "git home"), GIT_CONFIG_NOSYSTEM: "1", GIT_INDEX_FILE: index };
    mkdirSync(gitEnv.HOME!);
    let result = run("git", ["read-tree", "HEAD"], ROOT, gitEnv); assert.equal(result.status, 0, result.stderr);
    result = run("git", ["add", "-A"], ROOT, gitEnv); assert.equal(result.status, 0, result.stderr);
    const tree = run("git", ["write-tree"], ROOT, gitEnv); assert.equal(tree.status, 0, tree.stderr);
    result = run("git", ["archive", "--format=tar", "-o", archive, tree.stdout.trim()], ROOT, gitEnv); assert.equal(result.status, 0, result.stderr);

    const source = join(temp, "agent plugins candidate"), home = join(temp, "empty home"), pathRoot = join(temp, "goose path root"), foreign = join(temp, "foreign cwd");
    mkdirSync(source); result = run("tar", ["-xf", archive, "-C", source], temp, process.env); assert.equal(result.status, 0, result.stderr);
    const sourceEnv = { ...process.env, HOME: gitEnv.HOME, GIT_CONFIG_NOSYSTEM: "1" };
    result = run("git", ["init", "-q"], source, sourceEnv); assert.equal(result.status, 0, result.stderr);
    for (const [key, value] of [["user.name", "QA"], ["user.email", "qa@example.invalid"]]) {
      result = run("git", ["config", key, value], source, sourceEnv); assert.equal(result.status, 0, result.stderr);
    }
    result = run("git", ["add", "-A"], source, sourceEnv); assert.equal(result.status, 0, result.stderr);
    result = run("git", ["commit", "-qm", "candidate"], source, sourceEnv); assert.equal(result.status, 0, result.stderr);
    mkdirSync(home); mkdirSync(pathRoot); mkdirSync(foreign);
    const gooseEnv = { ...process.env, HOME: home, GOOSE_PATH_ROOT: pathRoot, GIT_CONFIG_NOSYSTEM: "1" };
    result = run(GOOSE, ["plugin", "install", "--auto-update", `file://${source}`], foreign, gooseEnv);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const name of names) assert.match(result.stdout, new RegExp(`agent-plugins:${name}`));

    const installed = join(pathRoot, ".agents", "plugins", "agent-plugins");
    const metadata = JSON.parse(readFileSync(join(installed, ".goose-plugin-install.json"), "utf8"));
    assert.equal(metadata.auto_update, true); assert.equal(metadata.source_type, "git");
    for (const name of names) {
      const launcher = join(installed, "skills", name, "scripts", `${name}.mjs`);
      const launched = run(process.execPath, [launcher, "--help"], foreign, { HOME: home, PATH: "", NODE_PATH: join(temp, "hostile modules"), GOOSE_PATH_ROOT: pathRoot });
      assert.equal(launched.status, 0, `${name}: ${launched.stderr || launched.stdout}`);
      assert.match(launched.stdout, /Usage:/); assert.equal(launched.stderr, "");
    }

    const pluginFile = join(source, "plugin.json"), plugin = JSON.parse(readFileSync(pluginFile, "utf8"));
    plugin.version = "0.5.1"; writeFileSync(pluginFile, `${JSON.stringify(plugin, null, 2)}\n`); writeFileSync(join(source, "qa-update-marker"), "updated\n");
    result = run("git", ["add", "plugin.json", "qa-update-marker"], source, sourceEnv); assert.equal(result.status, 0, result.stderr);
    result = run("git", ["commit", "-qm", "safe local update"], source, sourceEnv); assert.equal(result.status, 0, result.stderr);
    result = run(GOOSE, ["plugin", "update", "agent-plugins"], foreign, gooseEnv); assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(readFileSync(join(installed, "plugin.json"), "utf8")).version, "0.5.1");
    assert.equal(readFileSync(join(installed, "qa-update-marker"), "utf8"), "updated\n");
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
