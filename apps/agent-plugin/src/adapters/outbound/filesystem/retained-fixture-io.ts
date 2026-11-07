import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RetainedFixtureIO } from "../../../application/ports/retained-fixture.ts";
import type { PreparationLocations, PreparationProof } from "../../../domain/retained-preparation.ts";
import type { EvaluationSource } from "../../../application/ports/evaluation-source.ts";
import type { EvaluationStore } from "../../../application/ports/evaluation-store.ts";

export class FilesystemRetainedFixtureIO implements RetainedFixtureIO {
  readonly source: EvaluationSource;
  readonly createStore: (locations: PreparationLocations) => EvaluationStore;
  readonly newId: () => string;
  constructor(source: EvaluationSource, createStore: (locations: PreparationLocations) => EvaluationStore, newId: () => string) {
    this.source = source; this.createStore = createStore; this.newId = newId;
  }
  async createSource(locations: PreparationLocations) {
    // Neutral source is evaluator-only; no seed script/oracle is installed in the candidate.
    const source = join(locations.evaluator, "neutral-source");
    await mkdir(join(source, "evals"), { recursive: true, mode: 0o700 });
    await writeFile(join(source, "SKILL.md"), "---\nname: neutral-proof\ndescription: Produces a neutral fixture answer.\n---\nReturn fixture proof.\n", { mode: 0o600, flag: "wx" });
    await writeFile(join(source, "evals/evals.json"), JSON.stringify({ evals: [{ id: 1, prompt: "Return fixture proof.", expectations: ["Answer contains fixture proof."] }] }), { mode: 0o600, flag: "wx" });
    return source;
  }
  bindings(locations: PreparationLocations, campaignId: string, attempts: { condition: "with" | "without"; id: string }[]) {
    return { registry_path: join(locations.candidate, "registry/evaluations.sqlite"), campaign_id: campaignId,
      with_attempt_id: attempts.find(attempt => attempt.condition === "with")?.id,
      ...(attempts.some(attempt => attempt.condition === "without") ? { without_attempt_id: attempts.find(attempt => attempt.condition === "without")?.id } : {}),
      new_export_path: join(locations.candidate, "new-export") };
  }
  async capture(locations: PreparationLocations): Promise<PreparationProof["manifest"]> {
    const manifest: PreparationProof["manifest"] = [];
    async function walk(directory: string, prefix: string) {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(join(directory, entry.name), relative);
        else {
          if (!entry.isFile()) throw new Error("Unsafe seed file");
          const bytes = await readFile(join(directory, entry.name));
          const destination = join(locations.evaluator, "seed", relative);
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          await writeFile(destination, bytes, { mode: 0o600, flag: "wx" });
          manifest.push({ path: relative, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
        }
      }
    }
    await walk(locations.candidate, ""); return manifest;
  }
}
