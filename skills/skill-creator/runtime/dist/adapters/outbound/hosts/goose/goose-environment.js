import { join } from "node:path";
import { contextKey, overrideKey, pathKey } from "./goose-configuration.js";
// SECURITY: candidate and judge Goose processes execute untrusted Skill/Plugin behavior
// and model-chosen tool calls. Forwarding the whole operator environment exposed
// unrelated tokens (npm/GitHub/cloud), the SSH agent socket and the D-Bus session
// (desktop keyring) to that code. Use an explicit allowlist instead of a denylist:
// unknown variables are dropped by default. Private HOME/XDG remains discovery
// isolation, not an operating-system sandbox (network and filesystem stay reachable).
const baseNames = new Set([
    "PATH", "LANG", "LANGUAGE", "TZ", "TERM", "NO_COLOR", "USER", "LOGNAME", "USERNAME", "SHELL",
    // Windows process essentials; absent on POSIX.
    "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
    // Network routing and trust needed to reach the provider; proxy userinfo is
    // registered for redaction by collectEnvironmentCredentials.
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR",
]);
const localeName = /^LC_[A-Z_]+$/i;
// Never forwarded, even when a provider prefix or explicit forward list matches.
const neverForward = /^(?:SSH_|DBUS_|GPG_|GNUPG|NPM_|GH_|GITHUB_|XAUTHORITY$|KRB5|DOCKER_|KUBECONFIG$)/i;
// Providers whose credential variables do not share the provider-id prefix. Other
// providers use `<PROVIDER_ID>_` (e.g. openai -> OPENAI_API_KEY, OPENAI_HOST;
// azure_openai -> AZURE_OPENAI_*). Unlisted credential names must be supplied via the
// copied secrets.yaml or an explicit forward list. Native verification is pending.
const providerAliases = {
    aws_bedrock: { prefixes: ["AWS_", "BEDROCK_"], names: [] },
    sagemaker_tgi: { prefixes: ["AWS_", "SAGEMAKER_"], names: [] },
    gcp_vertex_ai: { prefixes: ["GCP_"], names: ["GOOGLE_APPLICATION_CREDENTIALS"] },
};
/** Inherited names a selected provider may need: `<ID>_*` plus documented aliases. */
function providerAllows(provider) {
    if (provider === undefined || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(provider))
        return () => false;
    const alias = providerAliases[provider.toLowerCase()];
    const prefixes = [`${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_`, ...(alias?.prefixes ?? [])];
    const names = new Set(alias?.names ?? []);
    return key => names.has(key.toUpperCase()) || prefixes.some(prefix => key.toUpperCase().startsWith(prefix));
}
/** Builds the private candidate/judge Goose environment from an explicit allowlist.
 * GOOSE_* settings are retained except context/path overrides (as before); private
 * HOME/XDG/temp locations are always injected. The caller's object is not mutated. */
export function isolatedEnvironment(original, root, policy = {}) {
    const env = {};
    const provider = providerAllows(policy.provider);
    const forward = new Set((policy.forward ?? []).map(name => name.toUpperCase()));
    for (const [key, value] of Object.entries(original)) {
        if (value === undefined || neverForward.test(key) || contextKey.test(key) || overrideKey.test(key))
            continue;
        const upper = key.toUpperCase();
        if (/^GOOSE_/.test(upper)) {
            if (!pathKey.test(key))
                env[key] = value;
            continue;
        }
        if (baseNames.has(upper) || localeName.test(key) || provider(key) || forward.has(upper))
            env[key] = value;
    }
    // GOOSE_PATH_ROOT bypasses native HOME/XDG discovery (upstream config/paths.rs).
    // Keep inherited overrides filtered; both candidate and judge validate reported info paths.
    Object.assign(env, {
        HOME: join(root, "home"), USERPROFILE: join(root, "home"), XDG_CONFIG_HOME: join(root, "home", ".config"),
        XDG_DATA_HOME: join(root, "home", ".local", "share"), XDG_STATE_HOME: join(root, "home", ".local", "state"),
        XDG_CACHE_HOME: join(root, "cache"), XDG_RUNTIME_DIR: join(root, "runtime"),
        APPDATA: join(root, "appdata"), LOCALAPPDATA: join(root, "localappdata"),
        TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
        CONTEXT_FILE_NAMES: "[]", GOOSE_DISABLE_SESSION_NAMING: "true",
    });
    return env;
}
