/** Known-credential detection shared by Goose candidate, model resolver and judge.
 *
 * Detected values feed exact-string redaction of collected evidence and the judge's
 * known-credential refusal. Over-collection is not harmless: a value such as "1",
 * "true", "localhost" or a socket path would be rewritten inside hashed evidence and
 * make the judge refuse ordinary packets. Under-collection leaks a real credential.
 *
 * Design (ap-dmoi.1 review): classify primarily by variable NAME, not by value shape.
 * Value-shape exclusions (leading "/", lowercase dotted text, digit-only) produced false
 * negatives for real secrets: base64 AWS keys may start with "/", tokens may be lowercase
 * dotted or digit-only passwords. Name classes:
 * - location names (`*_FILE`, `*_PATH`, `*_DIR`, `*_SOCK`, `*_SOCKET`, XAUTHORITY,
 *   GOOGLE_APPLICATION_CREDENTIALS, ...) name a resource, never its secret: ignored;
 * - credential names: long words anywhere, short words (KEY/AUTH/PASS/PWD/DSN) only as
 *   whole `_` words; setting names (`*_MODE`, `*_ALGORITHM`, `*_NAME`, ...) are excluded;
 * - endpoint, setting and all other names (`*_HOST`, `*_ENDPOINT`, `DATABASE_URL`, ...):
 *   only URL userinfo can be secret, registered whatever the name;
 * - password-class names (PASSWORD/PASSWD/PASSPHRASE/SECRET) and stored secrets: any
 *   non-boolean value of at least 6 characters, including digit-only values. Human-chosen passwords are short and
 *   six characters is the usual minimum password policy; such names rarely carry flags,
 *   and shorter values (TTL "3600", "365") are durations or counts;
 * - other credential names (KEY/TOKEN/AUTH/CREDENTIAL): non-boolean values of at least 8
 *   characters; pure numbers shorter than 16 digits are counts, durations, timestamps or
 *   ports (FEATURE_TOKEN_CACHE=1, TOKEN_EXPIRY=86400000). URL values contribute userinfo,
 *   and the whole URL plus token-like path segments when a query/fragment or a token-like
 *   path segment can embed a credential (webhook URLs).
 */
/** Generic credential-named values shorter than this are flags, ports or units. */
export const MINIMUM_CREDENTIAL_LENGTH = 8;
/** Password-class names and stored secrets (secrets.yaml) accept shorter human passwords. */
export const MINIMUM_PASSWORD_LENGTH = 6;
const booleanValue = /^(?:true|false|yes|no|on|off|null|none|enabled|disabled|0|1)$/i;
const numberValue = /^[+-]?\d+(?:\.\d+)?$/;
// Locations under well-known filesystem roots, not arbitrary leading-slash text: a base64
// secret such as "/wJalrXUtnFEMI/K7MDENG" must remain a credential.
const filesystemLocation = /^(?:~|\/(?:home|root|run|tmp|var|etc|usr|opt|mnt|media|srv|private|Users|Library|proc|dev|nix|snap)|[A-Za-z]:[\\/])(?:[\\/]|$)/;
const localAddress = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/i;
function excludedValue(trimmed) {
    return booleanValue.test(trimmed) || filesystemLocation.test(trimmed) || localAddress.test(trimmed);
}
/** Generic credential-named value (KEY/TOKEN/AUTH/CREDENTIAL). */
export function plausibleCredentialValue(value) {
    const trimmed = value.trim();
    if (trimmed.length < MINIMUM_CREDENTIAL_LENGTH || excludedValue(trimmed))
        return false;
    return !(numberValue.test(trimmed) && trimmed.replace(/\D/g, "").length < 16);
}
/** Password-class names and values stored in a secret file (secrets.yaml, credential-named
 * configuration keys): at least 6 characters, digit-only passwords included; booleans,
 * filesystem locations and local addresses excluded. */
export function plausibleStoredSecret(value) {
    const trimmed = value.trim();
    return trimmed.length >= MINIMUM_PASSWORD_LENGTH && !excludedValue(trimmed);
}
// Long, unambiguous credential words match anywhere (APIKEY, SECRETKEY, OAUTH_TOKEN).
// Short words match only as whole `_`-separated words: substring AUTH/KEY matched
// GIT_AUTHOR_NAME or KEYBOARD_LAYOUT and rewrote ordinary words in evidence (review 2026-11-19).
const credentialName = /TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|APIKEY|ACCESSKEY|PRIVATEKEY|BEARER|PROXY|(?:^|_)(?:KEY|KEYS|AUTH|PASS|PWD|DSN)(?:_|$)/i;
const passwordName = /PASSWORD|PASSWD|PASSPHRASE|SECRET|(?:^|_)(?:PASS|PWD)(?:_|$)/i;
// Credential-adjacent settings whose values describe a mechanism or identity, never the
// secret itself (AUTH_MODE=interactive, KEY_ALGORITHM=rsa-sha256, TOKEN_TYPE=bearer).
// PWD/OLDPWD are the shell working directories, not passwords.
const settingName = /^(?:PWD|OLDPWD)$|(?:^|_)(?:MODE|TYPE|METHOD|ALGORITHM|ALG|SCHEME|PROVIDER|NAME|EMAIL|USER|USERNAME|ENABLED|DISABLED|EXPIRY|EXPIRES|TTL|TIMEOUT|LAYOUT|FORMAT|VERSION)$/i;
const proxyName = /(?:^|_)PROXY$/i;
// Resource locations and local agent/socket/authority identifiers, never secret values.
const locationName = /^(?:NO_PROXY|GOOSE_DISABLE_KEYRING|XAUTHORITY|GPG_AGENT_INFO|GOOGLE_APPLICATION_CREDENTIALS|KUBECONFIG)$|(?:^|_)(?:FILE|FILES|PATH|PATHS|DIR|DIRECTORY|SOCK|SOCKET|AUTHORITY)$/i;
// Network endpoints: only URL userinfo can carry a credential.
const endpointName = /(?:^|_)(?:HOST|HOSTNAME|ENDPOINT|BASE_URL|SERVER|DOMAIN|PORT)$/i;
const urlValue = /^[a-z][a-z0-9+.-]*:\/\//i;
/** Path segments shaped like tokens (webhook secrets), not words such as "oauth". */
function tokenSegments(url) {
    return url.pathname.split("/").filter(segment => segment.length >= 16 &&
        [/[a-z]/, /[A-Z]/, /\d/].filter(pattern => pattern.test(segment)).length >= 2);
}
/** Adds URL userinfo credentials (raw and percent-decoded), never the host alone. With
 * `embedded`, a query/fragment or token-like path segment registers the whole URL and
 * those segments, because the URL itself then carries the secret. */
function urlCredentials(value, destination, embedded) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        if (embedded && plausibleCredentialValue(value))
            destination.add(value);
        return;
    }
    if (embedded) {
        const segments = tokenSegments(url);
        if (url.search || url.hash || segments.length)
            destination.add(value);
        for (const segment of segments)
            destination.add(segment);
    }
    if (!url.username && !url.password)
        return;
    const candidates = [url.password, url.username && url.password ? `${url.username}:${url.password}` : url.username];
    for (const candidate of candidates) {
        if (!candidate)
            continue;
        let decoded = candidate;
        try {
            decoded = decodeURIComponent(candidate);
        }
        catch { /* Keep the raw form only. */ }
        for (const form of new Set([candidate, decoded]))
            if (plausibleStoredSecret(form))
                destination.add(form);
    }
}
/** Registers credential values from credential-named environment variables using the
 * name classes documented above. The caller's environment is not modified. */
export function collectEnvironmentCredentials(env, destination) {
    for (const [key, value] of Object.entries(env)) {
        if (!value || locationName.test(key))
            continue;
        const url = urlValue.test(value.trim());
        // URL userinfo is a credential whatever the variable name (OPENAI_HOST,
        // OLLAMA_HOST, DATABASE_URL, SENTRY_DSN): provider endpoints reach trials.
        if (proxyName.test(key) || endpointName.test(key) || settingName.test(key) || !credentialName.test(key)) {
            if (url)
                urlCredentials(value.trim(), destination, false);
            continue;
        }
        if (url)
            urlCredentials(value.trim(), destination, true);
        else if (passwordName.test(key) ? plausibleStoredSecret(value) : plausibleCredentialValue(value))
            destination.add(value);
    }
}
