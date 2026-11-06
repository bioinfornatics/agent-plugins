export function skillFormatResult(diagnostics, unvalidatedExtensions = []) {
    return { valid: diagnostics.length === 0, scope: "skill-format", diagnostics, unvalidatedExtensions };
}
/** Validate source metadata, never the host-prefixed name of a private installed copy. */
export function validateSkillFrontmatter(frontmatter, directoryName) {
    const diagnostics = [];
    const fail = (field, message) => { diagnostics.push({ field, message }); };
    if (!(frontmatter instanceof Map))
        return skillFormatResult([{ field: "frontmatter", message: "Frontmatter must be a YAML mapping" }]);
    if ([...frontmatter.keys()].some(key => typeof key !== "string"))
        fail("frontmatter", "Frontmatter keys must be strings");
    const text = (field, required, maximum) => {
        if (!frontmatter.has(field) && !required)
            return;
        const value = frontmatter.get(field);
        if (typeof value !== "string") {
            fail(field, `${field} must be a string${required ? " (required)" : ""}`);
            return;
        }
        if (maximum !== undefined && (!value.trim() || [...value].length > maximum))
            fail(field, `${field} must contain 1-${maximum} characters and not be whitespace-only`);
        return value;
    };
    const name = text("name", true, 64);
    if (name !== undefined) {
        // The spec says "unicode" but explicitly lists a-z/0-9. Use the documented conservative ASCII
        // subset, without trimming invalid source names or applying host namespaces.
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
            fail("name", "name must use ASCII lowercase letters, digits and single internal hyphens");
        if (name !== directoryName)
            fail("name", "name must match the Skill directory name");
    }
    text("description", true, 1024);
    text("compatibility", false, 500);
    text("license", false);
    text("allowed-tools", false);
    if (frontmatter.has("metadata")) {
        const metadata = frontmatter.get("metadata");
        if (!(metadata instanceof Map) || [...metadata].some(([key, value]) => typeof key !== "string" || typeof value !== "string"))
            fail("metadata", "metadata must be a map from string keys to string values");
    }
    // Unknown fields have no normative rejection rule. Report them as unvalidated,
    // rather than claiming their extension contracts were checked successfully.
    const known = ["name", "description", "compatibility", "license", "allowed-tools", "metadata"];
    return skillFormatResult(diagnostics, [...frontmatter.keys()].filter((key) => typeof key === "string" && !known.includes(key)).sort());
}
