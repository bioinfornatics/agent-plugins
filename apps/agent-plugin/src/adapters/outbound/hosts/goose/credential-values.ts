/** Known-credential detection shared by Goose candidate, model resolver and judge.
 *
 * Detected values feed exact-string redaction of collected evidence and the judge's
 * known-credential refusal. Over-collection is not harmless: a value such as "1",
 * "true", "localhost" or a socket path would be rewritten inside hashed evidence and
 * make the judge refuse ordinary packets. Under-collection leaks a real credential.
 * Keep both risks in view: only plausible credential values are registered.
 */

/** Shorter values are flags, ports, short identifiers or units, not credentials worth
 * rewriting everywhere they occur. Real provider keys/tokens are much longer. */
export const MINIMUM_CREDENTIAL_LENGTH = 8;

/** True when a string can plausibly be a credential rather than a flag, number,
 * filesystem location or bare host name. */
export function plausibleCredentialValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < MINIMUM_CREDENTIAL_LENGTH) return false;
  if (/^(?:true|false|yes|no|on|off|null|none|enabled|disabled)$/i.test(trimmed)) return false;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) return false;
  // Absolute paths (sockets, credential *file locations*) name a resource, not its secret.
  if (/^(?:\/|~\/|[A-Za-z]:[\\/])/.test(trimmed)) return false;
  // localhost, IPv4 and lowercase DNS names (optionally with port). Mixed-case dotted
  // tokens such as JWTs remain credentials.
  return !/^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?$/.test(trimmed);
}

const credentialName = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|PROXY/i;
// Proxy URLs are network routing, not credentials; only their userinfo can be secret.
const proxyName = /^(?:HTTPS?|ALL|FTP|SOCKS5?|RSYNC)_PROXY$/i;
// Names matching credentialName that carry no credential value: proxy exclusions,
// boolean switches and local socket/authority file locations.
const nonCredentialName = /^(?:NO_PROXY|GOOSE_DISABLE_KEYRING|SSH_AUTH_SOCK|XAUTHORITY|GPG_AGENT_INFO)$|(?:^|_)(?:SOCK|SOCKET)$|AUTHORITY$/i;

const urlValue = /^[a-z][a-z0-9+.-]*:\/\//i;
/** Adds URL userinfo credentials (raw and percent-decoded), never the host. A query or
 * fragment may embed a token, so such URLs are registered whole. */
function urlCredentials(value: string, destination: Set<string>): void {
  let url: URL;
  try { url = new URL(value); } catch { if (plausibleCredentialValue(value)) destination.add(value); return; }
  if ((url.search || url.hash) && plausibleCredentialValue(value)) destination.add(value);
  if (!url.username && !url.password) return;
  const candidates = [url.password, url.username && url.password ? `${url.username}:${url.password}` : url.username];
  for (const candidate of candidates) {
    if (!candidate) continue;
    let decoded = candidate;
    try { decoded = decodeURIComponent(candidate); } catch { /* Keep the raw form only. */ }
    for (const form of new Set([candidate, decoded])) if (plausibleCredentialValue(form)) destination.add(form);
  }
}

/** Registers plausible credential values from credential-named environment variables.
 * The caller's environment is not modified. */
export function collectEnvironmentCredentials(env: NodeJS.ProcessEnv, destination: Set<string>): void {
  for (const [key, value] of Object.entries(env)) {
    if (!value || nonCredentialName.test(key)) continue;
    if (proxyName.test(key)) { if (urlValue.test(value)) urlCredentials(value, destination); continue; }
    if (!credentialName.test(key)) continue;
    if (urlValue.test(value)) urlCredentials(value, destination);
    else if (plausibleCredentialValue(value)) destination.add(value);
  }
}
