import type { SkillFormatSource } from "../../../application/ports/skill-format-source.ts";
import { validateSkill } from "../../../application/use-cases/validate-skill.ts";
import { EvaluationError } from "../../../domain/evaluation.ts";
import type { CliOutput } from "./cli-output.ts";

export type ValidateHandler = (skillPath: string, json: boolean) => Promise<void>;
export function createValidateCommandHandler(output: CliOutput, source: SkillFormatSource): ValidateHandler {
  return async function handleValidateCommand(skillPath, json) {
    const result = await validateSkill(skillPath, source);
    if (json) output.writeOut(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) throw new EvaluationError(json ? "Skill format validation failed" : result.diagnostics.map(item => `${item.field}: ${item.message}`).join("; "));
    if (!json) output.writeOut(`Skill format valid; extensions not validated: ${result.unvalidatedExtensions.join(", ") || "none"}\n`);
  };
}
