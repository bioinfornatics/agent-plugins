import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const result = spawnSync(process.execPath, [tsc, "-p", path.join(root, "tsconfig.json")], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
