import type { SkillFormatSource } from "../ports/skill-format-source.ts";
import { skillFormatResult, validateSkillFrontmatter, type SkillFormatResult } from "../../domain/skill-format.ts";

export async function validateSkill(skillPath: string, source: SkillFormatSource): Promise<SkillFormatResult> {
  const document = await source.read(skillPath);
  if (document.diagnostics.length) return skillFormatResult(document.diagnostics);
  return validateSkillFrontmatter(document.frontmatter, document.directoryName);
}
