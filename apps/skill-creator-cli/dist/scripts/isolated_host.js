/** Discovery/config isolation only, not an OS sandbox. No ambient profiles or secret files are copied. */
import { mkdirSync, mkdtempSync, rmSync, existsSync, lstatSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import yaml from "js-yaml";
import { readTrustedSnapshot } from "./trusted_snapshot.js";
const selector = (value) => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
// Explicit environment transport from official provider/environment docs; never
// arbitrary secret wildcards, profiles, runtime injection or telemetry passthrough.
const TRANSPORT_KEYS = new Set("GOOSE_PROVIDER GOOSE_MODEL GOOSE_PROVIDER__TYPE GOOSE_PROVIDER__HOST GOOSE_PROVIDER__API_KEY AIMLAPI_API_KEY ANTHROPIC_API_KEY ANTHROPIC_HOST AVIAN_API_KEY AVIAN_HOST AZURE_OPENAI_ENDPOINT AZURE_OPENAI_DEPLOYMENT_NAME AZURE_OPENAI_API_KEY AZURE_OPENAI_AD_TOKEN AZURE_OPENAI_API_VERSION AZURE_FOUNDRY_ENDPOINT AZURE_FOUNDRY_API_KEY AZURE_FOUNDRY_AD_TOKEN AZURE_FOUNDRY_API_VERSION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_REGION AWS_DEFAULT_REGION AWS_BEARER_TOKEN_BEDROCK SAGEMAKER_ENDPOINT_NAME DATABRICKS_HOST DATABRICKS_TOKEN EMPIRIOLABS_API_KEY FRIENDLI_API_KEY FUTURMIX_API_KEY GOOGLE_API_KEY GEMINI3_THINKING_LEVEL GONDOLA_API_KEY GONDOLA_HOST GROQ_API_KEY SPARK_API_PASSWORD ASTRON_API_KEY ASTRON_BASE_URL IONET_API_KEY LITELLM_HOST LITELLM_BASE_PATH LITELLM_API_KEY LITELLM_CUSTOM_HEADERS LITELLM_TIMEOUT META_MODEL_API_KEY MISTRAL_API_KEY NEARAI_API_KEY NOVITA_API_KEY OLLAMA_HOST OLLAMA_CLOUD_API_KEY OPENAI_API_KEY OPENAI_HOST OPENAI_BASE_PATH OPENAI_ORGANIZATION OPENAI_PROJECT OPENAI_CUSTOM_HEADERS OPENROUTER_API_KEY OPENROUTER_HOST OPENROUTER_PARAMETERS PERPLEXITY_API_KEY OVHCLOUD_API_KEY ROUTSTR_API_KEY ROUTSTR_HOST SAYGM_API_KEY SALAD_CLOUD_API_KEY SCW_SECRET_KEY SNOWFLAKE_HOST SNOWFLAKE_TOKEN TANZU_AI_API_KEY TANZU_AI_ENDPOINT TETRATE_API_KEY TETRATE_HOST TRUSTEDROUTER_API_KEY VENICE_API_KEY VENICE_HOST VENICE_BASE_PATH VENICE_MODELS_PATH CEREBRAS_API_KEY XAI_API_KEY XAI_HOST ZAI_CODING_PLAN_API_KEY HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy".split(" "));
// PATH is executable lookup only, not a sandbox or tool-permission boundary.
const EXECUTION_KEYS = ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ"];
/** Unsupported profile-dependent transports must use a separately verified adapter. */
export function assertIsolatedTransport(env) {
    const provider = env.GOOSE_PROVIDER?.toLowerCase() ?? "";
    if (!provider)
        return; // selected host reports no-provider infrastructure itself
    const keys = {
        openai: ["OPENAI_API_KEY"], anthropic: ["ANTHROPIC_API_KEY"], gemini: ["GOOGLE_API_KEY"], groq: ["GROQ_API_KEY"], openrouter: ["OPENROUTER_API_KEY"],
        databricks: ["DATABRICKS_TOKEN"], azure_openai: ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_AD_TOKEN"], "azure-openai": ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_AD_TOKEN"],
        azure_foundry: ["AZURE_FOUNDRY_API_KEY", "AZURE_FOUNDRY_AD_TOKEN"], "azure-foundry": ["AZURE_FOUNDRY_API_KEY", "AZURE_FOUNDRY_AD_TOKEN"],
        aimlapi: ["AIMLAPI_API_KEY"], avian: ["AVIAN_API_KEY"], empiriolabs: ["EMPIRIOLABS_API_KEY"], friendli: ["FRIENDLI_API_KEY"], futurmix: ["FUTURMIX_API_KEY"], gondola: ["GONDOLA_API_KEY"],
        spark: ["SPARK_API_PASSWORD"], astron: ["ASTRON_API_KEY"], ionet: ["IONET_API_KEY"], meta: ["META_MODEL_API_KEY"], mistral: ["MISTRAL_API_KEY"], nearai: ["NEARAI_API_KEY"], novita: ["NOVITA_API_KEY"],
        "ollama-cloud": ["OLLAMA_CLOUD_API_KEY"], perplexity: ["PERPLEXITY_API_KEY"], ovhcloud: ["OVHCLOUD_API_KEY"], routstr: ["ROUTSTR_API_KEY"], saygm: ["SAYGM_API_KEY"], saladcloud: ["SALAD_CLOUD_API_KEY"],
        scaleway: ["SCW_SECRET_KEY"], snowflake: ["SNOWFLAKE_TOKEN"], tanzu: ["TANZU_AI_API_KEY"], tetrate: ["TETRATE_API_KEY"], trustedrouter: ["TRUSTEDROUTER_API_KEY"], venice: ["VENICE_API_KEY"], cerebras: ["CEREBRAS_API_KEY"], xai: ["XAI_API_KEY"], "zai-coding-plan": ["ZAI_CODING_PLAN_API_KEY"]
    };
    if (/bedrock|sagemaker/.test(provider)) {
        if (env.AWS_BEARER_TOKEN_BEDROCK || (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY))
            return;
        throw new Error("Unsupported isolated AWS transport: supply explicit environment credentials, not a profile or credential chain");
    }
    if (["ollama", "ramalama", "lmstudio", "docker-model-runner", "litellm", "atomic"].includes(provider))
        return;
    if (keys[provider]) {
        if (env.GOOSE_PROVIDER__API_KEY || keys[provider].some(key => env[key]))
            return;
        throw new Error("Unsupported isolated provider transport: supply documented environment credentials; keyring/secrets files are not imported");
    }
    throw new Error("Unsupported isolated provider transport: CLI/OAuth/custom/credential-chain or unknown provider needs a separately verified adapter");
}
export function isolatedHostEnvironment(root) {
    const home = join(resolve(root), ".host");
    mkdirSync(home, { recursive: true, mode: 0o700 });
    if (lstatSync(home).isSymbolicLink() || !lstatSync(home).isDirectory())
        throw new TypeError("Isolated host state must be a regular directory");
    const temporary = join(home, "tmp");
    mkdirSync(temporary, { recursive: true, mode: 0o700 });
    if (lstatSync(temporary).isSymbolicLink() || !lstatSync(temporary).isDirectory())
        throw new TypeError("Isolated temporary state must be a regular directory");
    const env = {};
    for (const key of [...EXECUTION_KEYS, ...TRANSPORT_KEYS])
        if (process.env[key] !== undefined)
            env[key] = process.env[key];
    Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: join(home, "config"), LOCALAPPDATA: join(home, "data"), XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"), XDG_STATE_HOME: join(home, "state"), XDG_CACHE_HOME: join(home, "cache"), GOOSE_PATH_ROOT: home, GOOSE_DISABLE_KEYRING: "1", TMPDIR: join(home, "tmp"), TMP: join(home, "tmp"), TEMP: join(home, "tmp") });
    // Config docs: active_provider/providers.<id>.model; legacy flat selectors remain readable.
    // Transport credentials/endpoints must be supplied by environment; file/keyring-only transport is unproven.
    const config = process.env.GOOSE_PATH_ROOT ? join(process.env.GOOSE_PATH_ROOT, "config", "config.yaml") : process.platform === "win32" && process.env.APPDATA ? join(process.env.APPDATA, "Block", "goose", "config", "config.yaml") : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "goose", "config.yaml");
    if (existsSync(config)) {
        const snapshot = readTrustedSnapshot(dirname(config), config, "host selector config", { maxBytes: 256 * 1024, allowEmpty: true });
        const value = yaml.load(snapshot.bytes.toString("utf8"), { schema: yaml.JSON_SCHEMA });
        const configuredProvider = selector(value?.active_provider) ? value.active_provider : selector(value?.GOOSE_PROVIDER) ? value.GOOSE_PROVIDER : undefined;
        if (!env.GOOSE_PROVIDER && configuredProvider)
            env.GOOSE_PROVIDER = configuredProvider;
        if (!env.GOOSE_MODEL) {
            const model = value?.providers && Object.hasOwn(value.providers, env.GOOSE_PROVIDER ?? "") ? value.providers[env.GOOSE_PROVIDER]?.model : undefined;
            if (selector(model))
                env.GOOSE_MODEL = model;
            else if (env.GOOSE_PROVIDER === configuredProvider && selector(value?.GOOSE_MODEL))
                env.GOOSE_MODEL = value.GOOSE_MODEL;
        }
    }
    return env;
}
export function temporaryHost() { const cwd = mkdtempSync(join(tmpdir(), "skill-grader-")); try {
    return { cwd, env: checkedEnvironment(cwd), cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}
catch (error) {
    rmSync(cwd, { recursive: true, force: true });
    throw error;
} }
function checkedEnvironment(root) { const env = isolatedHostEnvironment(root); assertIsolatedTransport(env); return env; }
