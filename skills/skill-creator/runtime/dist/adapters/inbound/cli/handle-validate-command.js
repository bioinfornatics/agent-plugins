import { validateSkill } from "../../../application/use-cases/validate-skill.js";
import { EvaluationError } from "../../../domain/evaluation.js";
export function createValidateCommandHandler(output, source) {
    return async function handleValidateCommand(skillPath, json) {
        const result = await validateSkill(skillPath, source);
        if (json)
            output.writeOut(`${JSON.stringify(result, null, 2)}\n`);
        if (!result.valid)
            throw new EvaluationError(json ? "Skill format validation failed" : result.diagnostics.map(item => `${item.field}: ${item.message}`).join("; "));
        if (!json)
            output.writeOut(`Skill format valid; extensions not validated: ${result.unvalidatedExtensions.join(", ") || "none"}\n`);
    };
}
