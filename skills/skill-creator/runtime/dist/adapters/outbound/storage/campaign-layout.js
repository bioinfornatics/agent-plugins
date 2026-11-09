import { validateCandidateModels } from "../../../domain/candidate-model.js";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { registryDirectory } from "./registry-files.js";
/** Publish evidence location and descriptive metadata before the campaign is inserted in SQLite.
 * Metadata is not operational authority: recovery/history use the stored DB path and frozen plan.
 * Inspect every shared Hive level privately; never repair existing modes or chmod shared ancestors.
 */
export async function publishCampaignDirectory(destination, id, plan, layout) {
    validateCandidateModels(plan.options);
    const root = resolve(destination);
    if (layout === "flat") {
        await registryDirectory(root, false);
        const output = join(root, id);
        await mkdir(output, { mode: 0o700 });
        await registryDirectory(output, true);
        return output;
    }
    if (!/^[0-9a-f]{64}$/.test(plan.profile.id))
        throw new Error("Invalid Hive profile id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        throw new Error("Invalid Hive campaign id");
    const model = plan.options.model;
    // Exact requested text (including Unicode and empty strings) is hashed, never a path segment.
    // Absence is distinct from an explicit request named "default"; no effective model is guessed.
    const candidateModels = plan.options.candidateModels;
    // Selection provenance deliberately does not partition the same resolved identity twice.
    const models = candidateModels && Object.keys(candidateModels).sort().map(agent => ({ agent, provider: candidateModels[agent]?.provider, model: candidateModels[agent]?.model }));
    const modelKey = models ? `configured-${createHash("sha256").update(JSON.stringify({ version: 1, models })).digest("hex")}` :
        model === undefined ? "default" : `requested-${createHash("sha256").update(JSON.stringify({ version: 1, model })).digest("hex")}`;
    const profileDirectory = join(root, `profile=${plan.profile.id}`);
    const modelDirectory = join(profileDirectory, `model=${modelKey}`);
    for (const directory of [root, profileDirectory, modelDirectory])
        await registryDirectory(directory, true);
    const output = join(modelDirectory, `campaign=${id}`);
    await mkdir(output, { mode: 0o700 });
    await registryDirectory(output, true);
    await writeFile(join(output, "campaign.json"), `${JSON.stringify({
        version: candidateModels ? 2 : 1, ...(candidateModels ? { candidateModels, partitionKey: modelKey } : {}), campaignId: id, profileId: plan.profile.id, revision: plan.profile.revision,
        requestedModel: model === undefined ? { kind: "default" } : { kind: "requested", model },
        agents: plan.options.agents,
    })}\n`, { flag: "wx", mode: 0o600 });
    return output;
}
