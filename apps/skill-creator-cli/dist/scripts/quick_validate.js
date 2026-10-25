#!/usr/bin/env node
// Quick validation script for skills - minimal version
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRuntimeDependency } from "./runtime-deps.js";
const yaml = loadRuntimeDependency("js-yaml");
const ALLOWED_PROPERTIES = new Set([
    "name", "description", "license", "allowed-tools", "metadata", "compatibility",
]);
export function validateSkill(skillPath) {
    const skillMd = join(skillPath, "SKILL.md");
    if (!existsSync(skillMd)) {
        return [false, "SKILL.md not found"];
    }
    const content = readFileSync(skillMd, "utf-8");
    if (!content.startsWith("---")) {
        return [false, "No YAML frontmatter found"];
    }
    const match = /^---\n([\s\S]*?)\n---/.exec(content);
    if (!match) {
        return [false, "Invalid frontmatter format"];
    }
    const frontmatterText = match[1];
    let frontmatter;
    try {
        frontmatter = yaml.load(frontmatterText);
        if (typeof frontmatter !== "object" || frontmatter === null || Array.isArray(frontmatter)) {
            return [false, "Frontmatter must be a YAML dictionary"];
        }
    }
    catch (error) {
        return [false, `Invalid YAML in frontmatter: ${error.message}`];
    }
    const fm = frontmatter;
    const unexpectedKeys = Object.keys(fm).filter((k) => !ALLOWED_PROPERTIES.has(k));
    if (unexpectedKeys.length) {
        return [
            false,
            `Unexpected key(s) in SKILL.md frontmatter: ${unexpectedKeys.sort().join(", ")}. ` +
                `Allowed properties are: ${Array.from(ALLOWED_PROPERTIES).sort().join(", ")}`,
        ];
    }
    if (!("name" in fm))
        return [false, "Missing 'name' in frontmatter"];
    if (!("description" in fm))
        return [false, "Missing 'description' in frontmatter"];
    const rawName = fm.name;
    if (typeof rawName !== "string") {
        return [false, `Name must be a string, got ${typeof rawName}`];
    }
    const name = rawName.trim();
    if (!name)
        return [false, "Name must not be empty"];
    const directoryName = skillPath.split(/[\\/]/).filter(Boolean).pop();
    if (name !== directoryName)
        return [false, "Name '" + name + "' must match skill directory '" + directoryName + "'"];
    if (name) {
        if (!/^[a-z0-9-]+$/.test(name)) {
            return [false, `Name '${name}' should be kebab-case (lowercase letters, digits, and hyphens only)`];
        }
        if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
            return [false, `Name '${name}' cannot start/end with hyphen or contain consecutive hyphens`];
        }
        if (name.length > 64) {
            return [false, `Name is too long (${name.length} characters). Maximum is 64 characters.`];
        }
    }
    const rawDescription = fm.description;
    if (typeof rawDescription !== "string") {
        return [false, `Description must be a string, got ${typeof rawDescription}`];
    }
    const description = rawDescription.trim();
    if (!description)
        return [false, "Description must not be empty"];
    if (description) {
        if (description.includes("<") || description.includes(">")) {
            return [false, "Description cannot contain angle brackets (< or >)"];
        }
        if (description.length > 1024) {
            return [false, `Description is too long (${description.length} characters). Maximum is 1024 characters.`];
        }
    }
    const compatibility = fm.compatibility ?? "";
    if (compatibility) {
        if (typeof compatibility !== "string") {
            return [false, `Compatibility must be a string, got ${typeof compatibility}`];
        }
        if (compatibility.length > 500) {
            return [false, `Compatibility is too long (${compatibility.length} characters). Maximum is 500 characters.`];
        }
    }
    return [true, "Skill is valid!"];
}
export function main() {
    const [skillDir] = process.argv.slice(2);
    if (!skillDir) {
        console.log("Usage: node quick_validate.js <skill_directory>");
        process.exit(1);
    }
    const [valid, message] = validateSkill(skillDir);
    console.log(message);
    process.exit(valid ? 0 : 1);
}
if (!import.meta.url.includes("/$bunfs/") && import.meta.url === `file://${process.argv[1]}`) {
    main();
}
