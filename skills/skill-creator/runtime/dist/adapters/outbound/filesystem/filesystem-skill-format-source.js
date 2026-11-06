import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseDocument } from "yaml";
/** Plain standalone directory/file reads, not packaging closure or sandbox validation. */
export class FilesystemSkillFormatSource {
    async read(skillPath) {
        const root = resolve(skillPath);
        const directoryName = basename(root);
        const failure = (field, message) => ({ directoryName, frontmatter: undefined, diagnostics: [{ field, message }] });
        let content;
        try {
            if (!(await stat(root)).isDirectory())
                return failure("skill-path", "Skill path must be a directory");
            const file = join(root, "SKILL.md");
            if (!(await stat(file)).isFile())
                return failure("SKILL.md", "SKILL.md must be a file");
            content = await readFile(file, "utf8");
        }
        catch (error) {
            const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
            return failure("SKILL.md", code === "ENOENT" ? "Skill directory or SKILL.md is missing" : "Unable to read Skill directory or SKILL.md");
        }
        const lines = content.split(/\r?\n/);
        if (lines[0] !== "---")
            return failure("frontmatter", "SKILL.md must start with YAML frontmatter delimiter ---");
        const end = lines.findIndex((line, index) => index > 0 && line === "---");
        if (end < 0)
            return failure("frontmatter", "YAML frontmatter must end with delimiter ---");
        try {
            const document = parseDocument(lines.slice(1, end).join("\n"));
            if (document.errors.length)
                return failure("frontmatter", "Malformed YAML frontmatter");
            // Preserve key types (including metadata numeric keys) instead of silently
            // coercing them to object property names before domain string-map checks.
            const frontmatter = document.toJS({ mapAsMap: true });
            return { directoryName, frontmatter, diagnostics: [] };
        }
        catch {
            return failure("frontmatter", "Malformed YAML frontmatter");
        }
    }
}
