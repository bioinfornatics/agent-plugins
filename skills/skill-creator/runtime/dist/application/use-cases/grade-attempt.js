import { validateJudgment } from "../../domain/judgment.js";
/** Each invocation is a new grade of one explicit attempt; candidate execution and source
 * discovery are intentionally absent. Judge protocol failures remain distinct from verdicts. */
export async function gradeAttempt(selection, dependencies, options) {
    options = options === undefined ? undefined : structuredClone(options);
    const attempt = await dependencies.reader.readAttempt({ campaignId: selection.campaignId, attemptId: selection.attemptId });
    const request = structuredClone(attempt.request);
    if (options !== undefined)
        request.options = { ...options };
    // Bind storage to detached options, not to caller or Judge mutations during awaits.
    let result;
    try {
        const judge = dependencies.judge ?? dependencies.createJudge?.();
        if (!judge)
            throw new Error("Judge dependency required");
        const response = await judge.judge(request);
        result = { outcome: validateJudgment(attempt.request.criteria, attempt.request.artifacts, response.outcome), provenance: response.provenance };
    }
    catch {
        // A rejected transport has no trustworthy provenance or business verdict. Raw
        // diagnostics may contain credentials; retain a bounded, non-sensitive failure.
        result = { outcome: { status: "technical-error", message: "Judge rejected or returned invalid judgment" }, provenance: null };
    }
    return dependencies.store.appendJudgment(dependencies.newId(), attempt, result, options);
}
