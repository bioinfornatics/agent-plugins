import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const dist = dirname(here);
const generatedSkillRoot = basename(dist) === "dist" && basename(dirname(dist)) === "runtime" ? dirname(dirname(dist)) : null;
export const APP_ROOT = basename(dist) === "dist" ? dirname(dist) : dist;
export const REPOSITORY_ROOT = generatedSkillRoot ? dirname(dirname(generatedSkillRoot)) : resolve(APP_ROOT, "../..");
export const PORTABLE_SKILL_ROOT = resolve(process.env.PLUGIN_CREATOR_SKILL_ROOT ?? generatedSkillRoot ?? resolve(REPOSITORY_ROOT, "skills/plugin-creator"));
export const portableSkillPath = (...segments) => resolve(PORTABLE_SKILL_ROOT, ...segments);
