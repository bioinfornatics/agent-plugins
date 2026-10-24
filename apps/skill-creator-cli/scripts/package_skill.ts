#!/usr/bin/env node
/**
 * Skill Packager - Creates a distributable .skill file of a skill folder
 *
 * Usage:
 *   node package_skill.js <path/to/skill-folder> [output-directory]
 */
import { existsSync, lstatSync, readdirSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join, basename, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type AdmZipType from "adm-zip";
import { validateSkill } from "./quick_validate.js";
import { auditSkill } from "./audit_skill.js";
import { loadRuntimeDependency } from "./runtime-deps.js";

const AdmZip = loadRuntimeDependency<typeof AdmZipType>("adm-zip");

const EXCLUDE_DIRS = new Set([".git", ".hg", ".svn", "__pycache__", "node_modules"]);
const EXCLUDE_GLOBS = ["*.pyc"];
const EXCLUDE_FILES = new Set([".DS_Store"]);
const ROOT_EXCLUDE_DIRS = new Set(["evals"]);
// ZIP stores timestamps as local DOS date fields. Constructing the minimum
// representable date in local time keeps package bytes stable across runs and
// time zones without claiming a source-file modification time.
const CANONICAL_ZIP_TIME = new Date(1980, 0, 1, 0, 0, 0, 0);
export type SkillPackageProfile = "authoring" | "release";

function addDeterministicFile(zip: AdmZipType, name: string, content: Buffer, mode: number): void {
  zip.addFile(name, content, "", mode);
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`Failed to create archive entry: ${name}`);
  entry.header.time = new Date(CANONICAL_ZIP_TIME.getTime());
}

function executableNames(skillName: string): string[] {
  return process.platform === "win32" ? [skillName + ".exe", skillName] : [skillName, skillName + ".exe"];
}

function findNativeExecutable(skillPath: string, skillName: string, explicit?: string): string | null {
  const candidates = explicit
    ? [resolve(explicit)]
    : executableNames(skillName).flatMap((name) => [join(skillPath, "bin", name), join(dirname(dirname(skillPath)), "bin", name)]);
  const found = candidates.find((candidate) => existsSync(candidate) && !isDir(candidate) && !isSymlink(candidate));
  if (!found) return null;
  if (explicit && ![skillName, skillName + ".exe"].includes(basename(found))) return null;
  return found;
}

function matchGlob(name: string, pattern: string): boolean {
  const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  return regex.test(name);
}

function shouldExclude(relParts: string[], profile: SkillPackageProfile): boolean {
  if (relParts.some((part, index) => EXCLUDE_DIRS.has(part) && !(profile === "authoring" && part === "node_modules" && (relParts[index - 1] === "runtime" || relParts[index - 1] === "vendor")))) return true;
  if (relParts.length > 1 && ROOT_EXCLUDE_DIRS.has(relParts[1])) return true;
  const name = relParts[relParts.length - 1];
  if (EXCLUDE_FILES.has(name) || EXCLUDE_GLOBS.some((pat) => matchGlob(name, pat))) return true;
  if (profile === "release") {
    const skillParts = relParts.slice(1);
    if (["scripts", "tests", "eval-viewer"].includes(skillParts[0] ?? "")) return true;
    if (/^tsconfig(?:\.[^.]+)?\.json$/.test(name)) return true;
    if (name.endsWith(".ts") && !name.endsWith(".d.ts")) return true;
  }
  return false;
}

function isDir(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function validateOfflineBundle(skillPath: string, profile: SkillPackageProfile, nativeExecutable: string | null): string[] {
  const packagePath = join(skillPath, "package.json");
  if (!existsSync(packagePath)) return [];
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  if (!pkg.offlineBundle) return [];
  const missing: string[] = [];
  if (!isDir(join(skillPath, "dist"))) missing.push("dist/");
  if (profile === "release") {
    if (!nativeExecutable) missing.push(`bin/${basename(skillPath)} (native executable)`);
    return missing;
  }
  if (!existsSync(join(skillPath, "vendor", "manifest.json"))) missing.push("vendor/manifest.json");
  if (!existsSync(join(skillPath, "THIRD_PARTY_NOTICES.md"))) missing.push("THIRD_PARTY_NOTICES.md");
  for (const dependency of Object.keys(pkg.dependencies ?? {})) {
    if (!isDir(join(skillPath, "vendor", "node_modules", dependency))) {
      missing.push(`vendor/node_modules/${dependency}`);
    }
  }
  return missing;
}

function collectFiles(current: string, out: string[], parentDir: string, profile: SkillPackageProfile) {
  for (const entry of readdirSync(current).sort()) {
    const full = join(current, entry);
    const relPath = full.slice(parentDir.length + 1);
    if (shouldExclude(relPath.split(/[\\/]/), profile)) continue;
    if (isSymlink(full)) throw new Error(`Refusing to package symbolic link: ${relPath}`);
    if (isDir(full)) collectFiles(full, out, parentDir, profile);
    else out.push(full);
  }
}

export function packageSkill(skillPathArg: string, outputDirArg?: string, profile: SkillPackageProfile = "authoring", executableArg?: string): string | null {
  const skillPath = resolve(skillPathArg);

  if (!existsSync(skillPath)) {
    console.log(`❌ Error: Skill folder not found: ${skillPath}`);
    return null;
  }
  if (!isDir(skillPath)) {
    console.log(`❌ Error: Path is not a directory: ${skillPath}`);
    return null;
  }

  const skillMd = join(skillPath, "SKILL.md");
  if (!existsSync(skillMd)) {
    console.log(`❌ Error: SKILL.md not found in ${skillPath}`);
    return null;
  }

  console.log("🔍 Validating skill...");
  const [valid, message] = validateSkill(skillPath);
  if (!valid) {
    console.log(`❌ Validation failed: ${message}`);
    console.log("   Please fix the validation errors before packaging.");
    return null;
  }
  console.log(`✅ ${message}\n`);

  console.log("🔎 Auditing authoring quality...");
  const audit = auditSkill(skillPath);
  for (const item of audit.findings) console.log(`  ${item.severity.toUpperCase()}: [${item.rule}] ${item.message}`);
  if (audit.status === "fail") {
    console.log("❌ Authoring audit failed. Fix error-level findings before packaging.");
    return null;
  }
  console.log(`✅ Authoring audit: ${audit.status}${audit.summary.warnings ? ` (${audit.summary.warnings} warning(s))` : ""}\n`);

  const skillName = basename(skillPath);
  const nativeExecutable = profile === "release" ? findNativeExecutable(skillPath, skillName, executableArg) : null;
  const missingOffline = validateOfflineBundle(skillPath, profile, nativeExecutable);
  if (missingOffline.length) {
    console.log(`❌ Offline bundle is incomplete: ${missingOffline.join(", ")}`);
    console.log("   Run the repository's scripts/prepare-offline-bundle.mjs before packaging.");
    return null;
  }

  let outputPath: string;
  if (outputDirArg) {
    outputPath = resolve(outputDirArg);
    mkdirSync(outputPath, { recursive: true });
  } else {
    outputPath = process.cwd();
  }
  const skillFilename = join(outputPath, `${skillName}.skill`);

  try {
    const zip = new AdmZip();
    const parentDir = dirname(skillPath);
    const allFiles: string[] = [];
    collectFiles(skillPath, allFiles, parentDir, profile);

    for (const filePath of allFiles) {
      const relPath = filePath.slice(parentDir.length + 1);
      const relParts = relPath.split(/[\\/]/);
      if (shouldExclude(relParts, profile)) continue;
      addDeterministicFile(zip, relPath.split(sep).join("/"), readFileSync(filePath), lstatSync(filePath).mode & 0o777);
      console.log(`  Added: ${relPath}`);
    }
    if (nativeExecutable && relative(skillPath, nativeExecutable).startsWith(".." + sep)) {
      const executableName = basename(nativeExecutable);
      addDeterministicFile(zip, `${skillName}/bin/${executableName}`, readFileSync(nativeExecutable), lstatSync(nativeExecutable).mode & 0o777);
      console.log(`  Added: ${skillName}/bin/${executableName}`);
    }

    zip.writeZip(skillFilename);
    console.log(`\n✅ Successfully packaged skill to: ${skillFilename}`);
    return skillFilename;
  } catch (error) {
    console.log(`❌ Error creating .skill file: ${(error as Error).message}`);
    return null;
  }
}

export function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: skill-creator package <skill-directory> [output-directory] [--profile authoring|release] [--executable FILE]");
    console.log("\nExample:");
    console.log("  node package_skill.js skills/public/my-skill");
    console.log("  node package_skill.js skills/public/my-skill ./dist");
    process.exit(1);
  }

  const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  for (const option of ["--profile", "--executable"]) {
    if (args.includes(option) && !value(option)) {
      console.error(`Error: ${option} requires a value`);
      process.exit(2);
    }
  }
  const profileValue = value("--profile") ?? (import.meta.url.includes("/$bunfs/") ? "release" : "authoring");
  if (profileValue !== "authoring" && profileValue !== "release") {
    console.error("Error: --profile must be authoring or release");
    process.exit(2);
  }
  const positionals = args.filter((arg, index) => !arg.startsWith("--") && (index === 0 || !["--profile", "--executable"].includes(args[index - 1])));
  const [skillPath, outputDir] = positionals;
  console.log(`📦 Packaging skill: ${skillPath}`);
  if (outputDir) console.log(`   Output directory: ${outputDir}`);
  console.log();

  const result = packageSkill(skillPath, outputDir, profileValue, value("--executable"));
  process.exit(result ? 0 : 1);
}

if (!import.meta.url.includes("/$bunfs/") && process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main();
}
