import type { Dirent } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { EvaluationError, type EvaluationTarget, type PreparedTarget, type Scenario } from "../../../domain/evaluation.ts";
import type { EvaluationSource } from "../../../application/ports/evaluation-source.ts";
import { captureSnapshot, readSnapshotFile, type SnapshotBudget } from "./evaluation-snapshot.ts";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function missing(error: unknown) { return record(error) && error.code === "ENOENT"; }
async function directory(path: string) {
  if (!(await lstat(path)).isDirectory()) throw new EvaluationError(`${path}: expected a directory`);
}
async function file(path: string) {
  if (!(await lstat(path)).isFile()) throw new EvaluationError(`${path}: expected a regular file`);
}
function onlyKeys(value: Record<string, unknown>, keys: string[], path: string) {
  const unsupported = Object.keys(value).filter((key) => !keys.includes(key));
  if (unsupported.length) throw new EvaluationError(`${path}: unsupported fields: ${unsupported.join(", ")}`);
}

/** Exact suite locations; missing plugin child suites alone may be skipped. */
export class FilesystemEvaluationSource implements EvaluationSource {
  fingerprint(value: string): string { return createHash("sha256").update(value).digest("hex"); }

  async load(target: EvaluationTarget): Promise<PreparedTarget> {
    try {
      const root = await realpath(resolve(target.root));
      await directory(root);
      const budget: SnapshotBudget = { bytes: 0, entries: 0 };
      let scenarios: Scenario[] = [];
      let installationName = basename(root);
      const skillRoots: string[] = [];
      if (target.kind === "skill") {
        await file(join(root, "SKILL.md"));
        skillRoots.push(root);
        scenarios = await this.readSuite(root, budget);
      } else {
        const manifestPath = join(root, "plugin.json");
        await file(manifestPath);
        const manifest: unknown = JSON.parse((await readSnapshotFile(manifestPath, budget)).bytes.toString("utf8"));
        if (!record(manifest) || typeof manifest.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(manifest.name)) throw new EvaluationError(`${manifestPath}: expected a plugin manifest with a safe installation name`);
        installationName = manifest.name;
        const skillsRoot = join(root, "skills");
        let entries: Dirent[];
        try { entries = await readdir(skillsRoot, { withFileTypes: true }); }
        catch (error) { if (!missing(error)) throw error; entries = []; }
        for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
          if (!entry.isDirectory()) continue;
          const skill = await realpath(join(skillsRoot, entry.name));
          try { await file(join(skill, "SKILL.md")); }
          catch (error) { if (missing(error)) continue; throw error; }
          skillRoots.push(skill);
          // Only an absent suite is skipped; malformed/unreadable present suites fail.
          try { await file(join(skill, "evals", "evals.json")); }
          catch (error) { if (missing(error)) continue; throw error; }
          scenarios.push(...await this.readSuite(skill, budget));
        }
        if (!scenarios.length) throw new EvaluationError(`${root}: no evaluation suites found in skills/*/evals/evals.json`);
      }
      const files = await captureSnapshot(root, false, budget);
      // Paths outside the install tree are provenance, not revision identity. Exact prompts,
      // ordered criteria and fixture bytes participate even though evals are never installed.
      const fingerprint = this.fingerprint(JSON.stringify({ kind: target.kind, installationName, files, scenarios: scenarios.map((scenario) => ({ id: scenario.id, sourceId: scenario.sourceId, prompt: scenario.prompt, expectations: scenario.expectations, fixturesFiles: scenario.fixturesFiles })) }));
      return { kind: target.kind, root, installationName, skillRoots, fingerprint, files, scenarios };
    } catch (error) {
      if (error instanceof EvaluationError) throw error;
      throw new EvaluationError(`${target.root}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async readSuite(skill: string, budget: SnapshotBudget): Promise<Scenario[]> {
    const suite = join(skill, "evals", "evals.json");
    await file(suite);
    const document: unknown = JSON.parse((await readSnapshotFile(suite, budget)).bytes.toString("utf8"));
    if (!record(document)) throw new EvaluationError(`${suite}: expected an object`);
    onlyKeys(document, ["evals", "skill_name"], suite);
    if (!Array.isArray(document.evals) || !document.evals.length) throw new EvaluationError(`${suite}: evals must be a nonempty array`);
    const seen = new Set<number>();
    const scenarios: Scenario[] = [];
    for (const [index, item] of document.evals.entries()) {
      const location = `${suite}: scenario ${index + 1}`;
      if (!record(item)) throw new EvaluationError(`${location}: expected an object`);
      onlyKeys(item, ["id", "prompt", "expectations", "assertions", "fixtures"], location);
      if (typeof item.id !== "number" || !Number.isSafeInteger(item.id) || seen.has(item.id)) throw new EvaluationError(`${location}: id must be a unique safe integer`);
      seen.add(item.id);
      if (typeof item.prompt !== "string" || !item.prompt.trim()) throw new EvaluationError(`${location}: prompt must be nonempty`);
      // The legacy assertions alias may coexist only with an identical, equally ordered list.
      if (item.expectations !== undefined && item.assertions !== undefined && JSON.stringify(item.expectations) !== JSON.stringify(item.assertions)) throw new EvaluationError(`${location}: conflicting expectations/assertions`);
      const expectations = item.expectations ?? item.assertions;
      if (!Array.isArray(expectations) || !expectations.length || expectations.some((text) => typeof text !== "string" || !text.trim())) throw new EvaluationError(`${location}: expectations must contain nonempty strings`);
      let fixtures: string | undefined;
      if (item.fixtures !== undefined) {
        if (typeof item.fixtures !== "string" || !item.fixtures.trim()) throw new EvaluationError(`${location}: fixtures must be a nonempty path`);
        // Suite-relative, not Skill-relative; external fixture directories are allowed at discovery.
        fixtures = await realpath(resolve(dirname(suite), item.fixtures));
        await directory(fixtures);
      }
      // Directory-based namespaces prevent child-suite ID collisions; skill_name is not an identity.
      scenarios.push({ id: `${basename(skill)}/${item.id}`, sourceId: item.id, skill, suite, prompt: item.prompt, expectations: [...expectations] as string[], ...(fixtures === undefined ? {} : { fixtures, fixturesFiles: await captureSnapshot(fixtures, true, budget) }) });
    }
    return scenarios;
  }
}
