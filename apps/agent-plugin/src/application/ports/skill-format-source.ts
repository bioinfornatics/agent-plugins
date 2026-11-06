import type { SkillFormatDiagnostic } from "../../domain/skill-format.ts";

/** Read only the standalone Skill's source frontmatter; no suite or snapshot needed. */
export interface SkillFormatSource {
  read(skillPath: string): Promise<{ directoryName: string; frontmatter: unknown; diagnostics: SkillFormatDiagnostic[] }>;
}
