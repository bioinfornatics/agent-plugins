import { validatePreparation } from "../../../domain/retained-preparation.js";
import { canonicalData, scenarioDiagnostics, scenarioExtensionFields } from "../../../domain/scenario-import.js";
import { captureDeclaredInputs } from "./declared-input-snapshot.js";
import { lstat, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { EvaluationError } from "../../../domain/evaluation.js";
import { captureSnapshot, readSnapshotFile } from "./evaluation-snapshot.js";
function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function missing(error) { return record(error) && error.code === "ENOENT"; }
async function directory(path) {
    if (!(await lstat(path)).isDirectory())
        throw new EvaluationError(`${path}: expected a directory`);
}
async function file(path) {
    if (!(await lstat(path)).isFile())
        throw new EvaluationError(`${path}: expected a regular file`);
}
function onlyKeys(value, keys, path) {
    const unsupported = Object.keys(value).filter((key) => !keys.includes(key));
    if (unsupported.length)
        throw new EvaluationError(`${path}: unsupported fields: ${unsupported.join(", ")}`);
}
/** Exact suite locations; missing plugin child suites alone may be skipped. */
export class FilesystemEvaluationSource {
    fingerprint(value) { return createHash("sha256").update(value).digest("hex"); }
    async load(target) {
        try {
            const root = await realpath(resolve(target.root));
            await directory(root);
            const budget = { bytes: 0, entries: 0 };
            let scenarios = [];
            let installationName = basename(root);
            const skillRoots = [];
            if (target.kind === "skill") {
                await file(join(root, "SKILL.md"));
                skillRoots.push(root);
                scenarios = await this.readSuite(root, budget);
            }
            else {
                const manifestPath = join(root, "plugin.json");
                await file(manifestPath);
                const manifest = JSON.parse((await readSnapshotFile(manifestPath, budget)).bytes.toString("utf8"));
                if (!record(manifest) || typeof manifest.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(manifest.name))
                    throw new EvaluationError(`${manifestPath}: expected a plugin manifest with a safe installation name`);
                installationName = manifest.name;
                const skillsRoot = join(root, "skills");
                let entries;
                try {
                    entries = await readdir(skillsRoot, { withFileTypes: true });
                }
                catch (error) {
                    if (!missing(error))
                        throw error;
                    entries = [];
                }
                for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
                    if (!entry.isDirectory())
                        continue;
                    const skill = await realpath(join(skillsRoot, entry.name));
                    try {
                        await file(join(skill, "SKILL.md"));
                    }
                    catch (error) {
                        if (missing(error))
                            continue;
                        throw error;
                    }
                    skillRoots.push(skill);
                    // Only an absent suite is skipped; malformed/unreadable present suites fail.
                    try {
                        await file(join(skill, "evals", "evals.json"));
                    }
                    catch (error) {
                        if (missing(error))
                            continue;
                        throw error;
                    }
                    scenarios.push(...await this.readSuite(skill, budget));
                }
                if (!scenarios.length)
                    throw new EvaluationError(`${root}: no evaluation suites found in skills/*/evals/evals.json`);
            }
            const files = await captureSnapshot(root, false, budget);
            // Paths outside the install tree are provenance, not revision identity. Exact prompts,
            // ordered criteria and fixture bytes participate even though evals are never installed.
            const fingerprint = this.fingerprint(JSON.stringify({ kind: target.kind, installationName, files, scenarios: scenarios.map((scenario) => ({ id: scenario.id, sourceId: scenario.sourceId, prompt: scenario.prompt, ...(scenario.preparation === undefined ? {} : { preparation: scenario.preparation }), expectations: scenario.expectations, fixturesFiles: scenario.fixturesFiles, ...(scenario.expectedOutput === undefined ? {} : { expectedOutput: scenario.expectedOutput }), ...(scenario.extensions === undefined ? {} : { extensions: scenario.extensions }), ...(scenario.suiteMetadata === undefined ? {} : { suiteMetadata: scenario.suiteMetadata }), ...(scenario.inputs === undefined ? {} : { inputs: scenario.inputs }) })) }));
            return { kind: target.kind, root, installationName, skillRoots, fingerprint, files, scenarios };
        }
        catch (error) {
            if (error instanceof EvaluationError)
                throw error;
            throw new EvaluationError(`${target.root}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async readSuite(skill, budget) {
        const suite = join(skill, "evals", "evals.json");
        await file(suite);
        const document = JSON.parse((await readSnapshotFile(suite, budget)).bytes.toString("utf8"));
        if (!record(document))
            throw new EvaluationError(`${suite}: expected an object`);
        onlyKeys(document, ["evals", "skill_name", "coverage_dimensions"], suite);
        if (document.skill_name !== undefined && (typeof document.skill_name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(document.skill_name)))
            throw new EvaluationError(`${suite}: skill_name must be a nonempty safe name`);
        if (!Array.isArray(document.evals) || !document.evals.length)
            throw new EvaluationError(`${suite}: evals must be a nonempty array`);
        const seen = new Set();
        const scenarios = [];
        for (const [index, item] of document.evals.entries()) {
            const location = `${suite}: scenario ${index + 1}`;
            if (!record(item))
                throw new EvaluationError(`${location}: expected an object`);
            onlyKeys(item, ["id", "prompt", "expectations", "assertions", "fixtures", "expected_output", "files", "preparation", ...scenarioExtensionFields], location);
            if (Object.hasOwn(item, "files") && Object.hasOwn(item, "fixtures"))
                throw new EvaluationError(`${location}: conflicting files/fixtures`);
            if (item.expected_output !== undefined && typeof item.expected_output !== "string")
                throw new EvaluationError(`${location}: expected_output must be a string`);
            if (typeof item.id !== "number" || !Number.isSafeInteger(item.id) || seen.has(item.id))
                throw new EvaluationError(`${location}: id must be a unique safe integer`);
            seen.add(item.id);
            if (typeof item.prompt !== "string" || !item.prompt.trim())
                throw new EvaluationError(`${location}: prompt must be nonempty`);
            validatePreparation(item.preparation, item.prompt);
            // The legacy assertions alias may coexist only with an identical, equally ordered list.
            if (item.expectations !== undefined && item.assertions !== undefined && JSON.stringify(item.expectations) !== JSON.stringify(item.assertions))
                throw new EvaluationError(`${location}: conflicting expectations/assertions`);
            const expectations = Object.hasOwn(item, "expectations") ? item.expectations : Object.hasOwn(item, "assertions") ? item.assertions : [];
            if (!Array.isArray(expectations) || expectations.some((text) => typeof text !== "string" || !text.trim()))
                throw new EvaluationError(`${location}: expectations must contain nonempty strings`);
            let fixtures;
            if (item.fixtures !== undefined) {
                if (typeof item.fixtures !== "string" || !item.fixtures.trim())
                    throw new EvaluationError(`${location}: fixtures must be a nonempty path`);
                // Suite-relative, not Skill-relative; external fixture directories are allowed at discovery.
                fixtures = await realpath(resolve(dirname(suite), item.fixtures));
                await directory(fixtures);
            }
            // Directory-based namespaces prevent child-suite ID collisions; skill_name is not an identity.
            const extensions = Object.fromEntries([...scenarioExtensionFields].sort().filter(field => Object.hasOwn(item, field)).map(field => [field, canonicalData(item[field])]));
            const declared = item.files === undefined ? undefined : await captureDeclaredInputs(skill, item.files, budget);
            const imported = {
                ...(item.preparation === undefined ? {} : { preparation: { kind: "retained-evaluation", version: 1, campaign: item.preparation.campaign } }),
                ...(item.expected_output === undefined ? {} : { expectedOutput: item.expected_output }),
                ...(!expectations.length ? { grading: { notable: false } } : {}),
                ...(!Object.keys(extensions).length ? {} : { extensions }),
                ...(document.coverage_dimensions === undefined ? {} : { suiteMetadata: { coverage_dimensions: canonicalData(document.coverage_dimensions) } }),
                ...(declared === undefined ? {} : { inputs: declared.inputs, fixturesFiles: declared.files }),
            };
            const diagnostics = scenarioDiagnostics(imported);
            if (diagnostics.length)
                imported.diagnostics = diagnostics;
            scenarios.push({ ...imported, id: `${basename(skill)}/${item.id}`, sourceId: item.id, skill, suite, prompt: item.prompt, expectations: [...expectations], ...(fixtures === undefined ? {} : { fixtures, fixturesFiles: await captureSnapshot(fixtures, true, budget) }) });
        }
        return scenarios;
    }
}
