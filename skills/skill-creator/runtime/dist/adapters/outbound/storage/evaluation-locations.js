import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { EvaluationError } from "../../../domain/evaluation.js";
/** Evaluations are portable user data, not cache/state (XDG Base Directory Specification 0.8).
 * Relative XDG_DATA_HOME is ignored. Overrides select a separate registry and default evidence root.
 * Resolve only on explicit execution, never during imports, help or dry-run.
 */
export function resolveEvaluationLocations(registry, output, env = process.env) {
    let registryPath;
    if (registry !== undefined) {
        if (!registry.trim())
            throw new EvaluationError("--registry must be a nonempty database path");
        registryPath = resolve(registry);
    }
    else {
        const xdg = env.XDG_DATA_HOME;
        const home = env.HOME || homedir();
        if (!xdg || !isAbsolute(xdg)) {
            if (!home || !isAbsolute(home))
                throw new EvaluationError("An absolute HOME or XDG_DATA_HOME is required for evaluation data");
        }
        registryPath = join(xdg && isAbsolute(xdg) ? xdg : join(home, ".local", "share"), "agent-plugin", "evaluations.sqlite");
    }
    if (output !== undefined && !output.trim())
        throw new EvaluationError("--output must be a nonempty evidence directory");
    return { registry: registryPath, output: output === undefined ? join(dirname(registryPath), "campaigns") : resolve(output) };
}
