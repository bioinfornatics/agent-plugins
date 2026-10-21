import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

/** Materialize inert fixture data outside host discovery roots. Never overwrite. */
export function materializeFixtures(source, destination) {
  if (lstatSync(source).isSymbolicLink()) throw new Error("Source symlinks are forbidden");
  const from = realpathSync(source), to = resolve(destination), temp = realpathSync(tmpdir());
  if (!lstatSync(from).isDirectory()) throw new Error("Source must be a directory");
  const insideTemp = relative(temp, to);
  if (!insideTemp || insideTemp === ".." || insideTemp.startsWith(".." + sep) || isAbsolute(insideTemp))
    throw new Error("Destination must be a new directory under the system temporary directory");
  const parts = to.split(sep);
  if (parts.some(p => [".agents", ".goose", ".claude"].includes(p))) throw new Error("Destination is a discovery root");
  let current = temp;
  for (const part of insideTemp.split(sep)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("Destination contains a symlink");
  }
  if (existsSync(to)) throw new Error("Destination already exists");
  if (to === from || to.startsWith(from + sep) || from.startsWith(to + sep)) throw new Error("Source and destination overlap");
  const files = [];
  function inspect(dir, prefix = "") {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), stat = lstatSync(path), rel = join(prefix, name);
      if (stat.isSymbolicLink()) throw new Error("Fixture symlinks are forbidden");
      if (stat.isDirectory()) inspect(path, rel);
      else if (stat.isFile()) {
        if (name === "SKILL.md") throw new Error("Fixture entrypoints must be inert SKILL.md.fixture files");
        const target = name === "SKILL.md.fixture" ? join(prefix, "SKILL.md") : rel;
        files.push({ path, target, mode: stat.mode & 0o777 });
      } else throw new Error("Unsupported fixture entry");
    }
  }
  inspect(from);
  mkdirSync(to, { recursive: true });
  try {
    for (const file of files) {
      const target = join(to, file.target); mkdirSync(dirname(target), { recursive: true });
      copyFileSync(file.path, target);
      // copyFile preserves source permission bits; verify through caller inventory.
    }
  } catch (error) { rmSync(to, { recursive: true, force: true }); throw error; }
  return to;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: node materialize-fixtures.mjs <fixture-directory> <new-temp-directory>");
    const destination = materializeFixtures(process.argv[2], process.argv[3]);
    console.log(JSON.stringify({ status: "materialized", destination }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
