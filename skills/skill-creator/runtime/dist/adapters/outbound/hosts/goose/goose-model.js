import { dirname, join } from "node:path";
import { parse } from "yaml";
import { collectEnvironmentCredentials } from "./credential-values.js";
import { record, secretStrings } from "./goose-configuration.js";
import { missing, regularFile, TREE_LIMIT } from "./private-files.js";
const IDENTITY_LIMIT = 512;
const FAILURE = "Unable to resolve a safe configured Goose provider/model identity.";
export function modelIdentity(value, secrets) {
    if (typeof value !== "string" || !value.trim() || value.length > IDENTITY_LIMIT || /\p{Cc}/u.test(value)
        || [...secrets].some(secret => secret.length > 0 && (value.includes(secret) || value.includes(JSON.stringify(secret).slice(1, -1)))))
        throw new Error(FAILURE);
    return value;
}
export function configuredGooseModel(value, secrets) {
    if (!record(value) || (value.source !== "configuration-default" && value.source !== "override"))
        throw new Error(FAILURE);
    return { source: value.source, provider: modelIdentity(value.provider, secrets), model: modelIdentity(value.model, secrets) };
}
/** v1.57 config/providers.rs skips malformed ProviderEntry values. Missing bools
 * default false and the model defaults empty; neither bool gates model selection.
 */
function structuredModel(config, provider) {
    if (!record(config.providers) || !Object.hasOwn(config.providers, provider))
        return undefined;
    const entry = config.providers[provider];
    if (!record(entry) || ["enabled", "configured"].some(key => Object.hasOwn(entry, key) && typeof entry[key] !== "boolean")
        || (Object.hasOwn(entry, "model") && typeof entry.model !== "string"))
        return undefined;
    return typeof entry.model === "string" && entry.model !== "" ? entry.model : undefined;
}
/** Reads the operator configuration and known credentials for bounded identity resolution. */
async function readSelectionConfiguration(info, env) {
    // Config::get_param also accepts generic uppercase overrides. They are not
    // part of this bounded resolver; refuse rather than freeze a different identity.
    if (env.ACTIVE_PROVIDER !== undefined || env.PROVIDERS !== undefined)
        throw new Error(FAILURE);
    const secrets = new Set();
    collectEnvironmentCredentials(env, secrets);
    let config = {};
    let size = 0;
    for (const path of [info.config, join(dirname(info.config), "secrets.yaml")]) {
        let bytes;
        try {
            bytes = await regularFile(path);
        }
        catch (error) {
            if (missing(error))
                continue;
            throw error;
        }
        size += bytes.length;
        if (size > TREE_LIMIT)
            throw new Error(FAILURE);
        const value = parse(bytes.toString("utf8"), { maxAliasCount: 50 });
        if (!record(value))
            throw new Error(FAILURE);
        secretStrings(value, secrets, path !== info.config);
        if (path === info.config)
            config = value;
    }
    if (!record(config))
        throw new Error(FAILURE);
    return { config, secrets };
}
function activeProvider(config, env, secrets) {
    return modelIdentity(env.GOOSE_PROVIDER ?? (typeof config.active_provider === "string" ? config.active_provider : config.GOOSE_PROVIDER), secrets);
}
/** Matches Goose v1.57 config/providers.rs get_active_provider/get_active_model:
 * environment, structured active-provider configuration, then legacy flat keys.
 * Explicit CLI model wins. Only identities leave this credential-aware boundary;
 * malformed entries fall back, but selected unsafe identities must be refused.
 */
export async function resolveGooseModel(info, env, options) {
    try {
        const { config, secrets } = await readSelectionConfiguration(info, env);
        const provider = activeProvider(config, env, secrets);
        return configuredGooseModel({ source: options.model === undefined ? "configuration-default" : "override",
            provider, model: options.model ?? env.GOOSE_MODEL ?? structuredModel(config, provider) ?? config.GOOSE_MODEL }, secrets);
    }
    catch {
        throw new Error(FAILURE);
    }
}
/** Provider id used only to select which inherited provider variables a private Goose
 * process receives (goose-environment.ts). Unresolvable/unsafe selection forwards none. */
export async function selectedGooseProvider(info, env) {
    try {
        const { config, secrets } = await readSelectionConfiguration(info, env);
        return activeProvider(config, env, secrets);
    }
    catch {
        return undefined;
    }
}
/** Goose v1.57 Session serializes these top-level fields. Metadata can describe
 * aliases/fallbacks, not prove the actual provider backend used by the request.
 * Validate only after the named conversation's prompt/output has been authenticated.
 */
export function observedGooseModel(data, secrets) {
    if (!record(data))
        throw new Error("Unsafe exported Goose model identity.");
    const provider = data.provider_name;
    const config = data.model_config;
    // Missing/null metadata is unknown. Present malformed fields are not absence.
    if (provider !== undefined && provider !== null)
        modelIdentity(provider, secrets);
    if (config !== undefined && config !== null && !record(config))
        throw new Error("Unsafe exported Goose model identity.");
    const model = record(config) ? config.model_name : undefined;
    if (model !== undefined && model !== null)
        modelIdentity(model, secrets);
    if (provider === undefined || provider === null || model === undefined || model === null)
        return null;
    return { provider: modelIdentity(provider, secrets), model: modelIdentity(model, secrets) };
}
