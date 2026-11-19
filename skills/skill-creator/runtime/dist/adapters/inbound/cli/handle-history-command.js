import { EvaluationError } from "../../../domain/evaluation.js";
/** Replaces C0/C1 control characters and DEL with `\u{XX}` escapes for terminal output. */
function printable(value) {
    return value.replace(/\p{Cc}/gu, character => `\\u{${character.charCodeAt(0).toString(16).padStart(2, "0")}}`);
}
/** Present read-only results; no execution dependencies are constructed. */
export function createHistoryCommandHandler(output, createHistory) {
    return async function handleHistoryCommand(input) {
        try {
            const history = createHistory(input.registry);
            if (input.campaign !== undefined) {
                const campaign = await history.inspect(input.campaign);
                if (input.json) {
                    output.writeOut(`${JSON.stringify(campaign, null, 2)}\n`);
                    return;
                }
                const lines = [`Campaign ${campaign.id}`, `Profile: ${campaign.profileName} (${campaign.profileId})`,
                    `Revision: ${campaign.revision}`, `Created: ${campaign.createdAt}`, `Status: ${campaign.status}; finalized ${campaign.finalized}/${campaign.total}; uncertain ${campaign.uncertain}`,
                    `Score: not available`, `Options: ${JSON.stringify(campaign.options)}`, `Evidence root: ${campaign.output}`];
                for (const trial of campaign.trials)
                    lines.push(`Trial ${trial.id}: ${trial.status}; latest attempt ${trial.attemptId ?? "none"}`);
                for (const attempt of campaign.attempts) {
                    lines.push(`  Attempt ${attempt.id} (${attempt.trialId}, ${attempt.condition}): ${attempt.status}/${attempt.collection}`);
                    for (const proof of attempt.evidence)
                        lines.push(`    ${proof.available ? "available" : "MISSING"}: ${proof.path}`);
                }
                // Residue names come from an unindexed directory listing: escape control characters so
                // a crafted name cannot forge terminal output or extra lines. Ordinary names are unchanged.
                for (const residue of campaign.residue)
                    lines.push(`Residue: ${printable(residue.path)} (interrupted publication of attempt ${printable(residue.attemptId)}; unindexed, unverified, may contain confidential evidence)`);
                if (campaign.residueScan === "unavailable")
                    lines.push("Residue scan unavailable: campaign root could not be listed; interrupted publications may exist");
                output.writeOut(`${lines.join("\n")}\n`);
            }
            else {
                const campaigns = await history.list(input.profile);
                if (input.json) {
                    output.writeOut(`${JSON.stringify(campaigns, null, 2)}\n`);
                    return;
                }
                if (!campaigns.length) {
                    output.writeOut("No evaluation campaigns found.\n");
                    return;
                }
                output.writeOut(`${campaigns.map(c => `${c.id}\t${c.profileName} [${c.profileId}]\t${c.revision}\t${c.createdAt}\t${c.status}\t${c.finalized}/${c.total}`).join("\n")}\n`);
            }
        }
        catch (error) {
            if (error instanceof EvaluationError)
                throw error;
            throw new EvaluationError("Unable to read evaluation history; no raw database diagnostics are exposed");
        }
    };
}
