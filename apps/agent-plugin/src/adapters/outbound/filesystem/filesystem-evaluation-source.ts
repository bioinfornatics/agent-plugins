import type { Dirent } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { EvaluationError, type EvaluationTarget, type PreparedTarget, type Scenario } from "../../../domain/evaluation.ts";
import type { EvaluationSource } from "../../../application/ports/evaluation-source.ts";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function missing(error: unknown) { return record(error) && error.code === "ENOENT"; }
async function directory(path: string) {
  if (!(await stat(path)).isDirectory()) throw new EvaluationError(`${path}: expected a directory`);
}
async function file(path: string) {
  if (!(await stat(path)).isFile()) throw new EvaluationError(`${path}: expected a regular file`);
}
function onlyKeys(value: Record<string, unknown>, keys: string[], path: string) {
  const unsupported = Object.keys(value).filter((key) => !keys.includes(key));
  if (unsupported.length) throw new EvaluationError(`${path}: unsupported fields: ${unsupported.join(", ")}`);
}

/** Exact suite locations; missing plugin child suites alone may be skipped. */
export class FilesystemEvaluationSource implements EvaluationSource {
  async load(target: EvaluationTarget): Promise<PreparedTarget> {
    try {
      const root = await realpath(resolve(target.root));
      await directory(root);
      let scenarios: Scenario[] = [];
      if (target.kind === "skill") {
        await file(join(root, "SKILL.md"));
        scenarios = await this.readSuite(root);
      } else {
        const manifestPath = join(root, "plugin.json");
        await file(manifestPath);
        const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
        if (!record(manifest) || typeof manifest.name !== "string" || !manifest.name.trim()) throw new EvaluationError(`${manifestPath}: expected a plugin manifest with a name`);
        const skillsRoot = join(root, "skills");
        let entries: Dirent[];
        try { entries = await readdir(skillsRoot, { withFileTypes: true }); }
        catch (error) { if (!missing(error)) throw error; entries = []; }
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (!entry.isDirectory()) continue;
          const skill = join(skillsRoot, entry.name);
          try { await file(join(skill, "SKILL.md")); }
          catch (error) { if (missing(error)) continue; throw error; }
          // Only an absent suite is skipped; malformed/unreadable present suites fail.
          try { await file(join(skill, "evals", "evals.json")); }
          catch (error) { if (missing(error)) continue; throw error; }
          scenarios.push(...await this.readSuite(skill));
        }
        if (!scenarios.length) throw new EvaluationError(`${root}: no evaluation suites found in skills/*/evals/evals.json`);
      }
      return { kind: target.kind, root, scenarios };
    } catch (error) {
      if (error instanceof EvaluationError) throw error;
      throw new EvaluationError(`${target.root}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async readSuite(skill: string): Promise<Scenario[]> {
    const suite = join(skill, "evals", "evals.json");
    await file(suite);
    const document: unknown = JSON.parse(await readFile(suite, "utf8"));
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
        fixtures = resolve(dirname(suite), item.fixtures);
        await directory(fixtures);
      }
      // Directory-based namespaces prevent child-suite ID collisions; skill_name is not an identity.
      scenarios.push({ id: `${basename(skill)}/${item.id}`, sourceId: item.id, skill, suite, prompt: item.prompt, expectations: [...expectations] as string[], ...(fixtures === undefined ? {} : { fixtures }) });
    }
    return scenarios;
  }
}
