import { skillFormatResult, validateSkillFrontmatter } from "../../domain/skill-format.js";
export async function validateSkill(skillPath, source) {
    const document = await source.read(skillPath);
    if (document.diagnostics.length)
        return skillFormatResult(document.diagnostics);
    return validateSkillFrontmatter(document.frontmatter, document.directoryName);
}
