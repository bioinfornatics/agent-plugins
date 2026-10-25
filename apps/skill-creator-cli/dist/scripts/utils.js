// Shared utilities for skill-creator scripts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
export function parseSkillMd(skillPath) {
    const content = readFileSync(join(skillPath, "SKILL.md"), "utf-8");
    const lines = content.split("\n");
    if (lines[0].trim() !== "---") {
        throw new Error("SKILL.md missing frontmatter (no opening ---)");
    }
    let endIdx = -1;
    for (let i = 1; i < lines.length; i += 1) {
        if (lines[i].trim() === "---") {
            endIdx = i;
            break;
        }
    }
    if (endIdx === -1) {
        throw new Error("SKILL.md missing frontmatter (no closing ---)");
    }
    let name = "";
    let description = "";
    const frontmatterLines = lines.slice(1, endIdx);
    let i = 0;
    while (i < frontmatterLines.length) {
        const line = frontmatterLines[i];
        if (line.startsWith("name:")) {
            name = line
                .slice("name:".length)
                .trim()
                .replace(/^"|"$/g, "")
                .replace(/^'|'$/g, "");
        }
        else if (line.startsWith("description:")) {
            const value = line.slice("description:".length).trim();
            if ([">", "|", ">-", "|-"].includes(value)) {
                const continuationLines = [];
                i += 1;
                while (i < frontmatterLines.length &&
                    (frontmatterLines[i].startsWith("  ") || frontmatterLines[i].startsWith("\t"))) {
                    continuationLines.push(frontmatterLines[i].trim());
                    i += 1;
                }
                description = continuationLines.join(" ");
                continue;
            }
            else {
                description = value.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
            }
        }
        i += 1;
    }
    return { name, description, content };
}
