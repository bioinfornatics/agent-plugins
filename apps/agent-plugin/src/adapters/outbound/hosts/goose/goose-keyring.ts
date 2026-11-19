import { execFile } from "node:child_process";
import { plausibleStoredSecret } from "./credential-values.ts";
import { providerAllows, neverForwardName } from "./goose-environment.ts";

// WHY: candidate and judge Goose processes run with an allowlisted environment that
// withholds the desktop session bus (D-Bus on Linux) and private HOME hides other
// credential stores, so their Goose cannot open the operator keyring (ap-dmoi.1).
// Goose >=1.x stores all configured secrets as one JSON object in the OS keyring
// (keyring crate: service "goose", user "secrets"; Linux label
// "secrets@goose:default", observed with Goose 1.57.0). This trusted CLI process reads
// that entry with the operating system's own tool and forwards ONLY the selected
// provider's variables, so the keyring itself and unrelated secrets stay unreachable
// from evaluated code (ap-j7r1). Goose reads environment variables before its keyring.
export const GOOSE_KEYRING_SERVICE = "goose";
export const GOOSE_KEYRING_ACCOUNT = "secrets";
const OUTPUT_LIMIT = 1024 * 1024;
const TIMEOUT_MS = 10_000;

/** One platform-native read of the Goose keyring entry. */
export interface KeyringCommand { executable: string; args: string[] }

// Windows Credential Manager via advapi32 CredReadW; keyring-rs stores the generic
// credential under target "<user>.<service>" with a UTF-16LE blob. Exit 2 = absent.
const windowsScript = `$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class AgentPluginGooseCredential {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize;
    public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr credential);
  public static string Read(string target) {
    IntPtr pointer; if (!CredReadW(target, 1, 0, out pointer)) return null;
    try { var value = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      return Marshal.PtrToStringUni(value.CredentialBlob, value.CredentialBlobSize / 2); }
    finally { CredFree(pointer); }
  }
}
'@
$value=[AgentPluginGooseCredential]::Read('${GOOSE_KEYRING_ACCOUNT}.${GOOSE_KEYRING_SERVICE}')
if ($null -eq $value) { exit 2 }
[Console]::Out.Write($value)`;

/** Platform-native keyring reader command, or undefined when the platform has none.
 * `secret-tool` and `powershell.exe` resolve through the operator PATH: the same trust
 * level as the `goose` executable itself, which is also PATH-resolved.
 * Linux/BSD: Secret Service via libsecret `secret-tool`; macOS: Keychain `security`;
 * Windows: Credential Manager through PowerShell. Only Linux is natively observed. */
export function keyringCommand(platform: NodeJS.Platform): KeyringCommand | undefined {
  if (platform === "darwin") return { executable: "/usr/bin/security", args: ["find-generic-password", "-s", GOOSE_KEYRING_SERVICE, "-a", GOOSE_KEYRING_ACCOUNT, "-w"] };
  if (platform === "win32") return { executable: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(windowsScript, "utf16le").toString("base64")] };
  if (["linux", "freebsd", "openbsd", "netbsd", "sunos"].includes(platform)) return { executable: "secret-tool", args: ["lookup", "service", GOOSE_KEYRING_SERVICE, "username", GOOSE_KEYRING_ACCOUNT] };
  return undefined;
}

/** Parses the Goose secrets JSON object; non-string values and malformed input are ignored. */
export function parseGooseSecrets(text: string): Record<string, string> | undefined {
  let value: unknown;
  // `security -w` and secret-tool may append a newline that is not part of the JSON value.
  try { value = JSON.parse(text.trim()); } catch { return undefined; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) if (typeof item === "string" && item !== "" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)) result[key] = item;
  return result;
}

/** Source of the operator's Goose keyring secrets. Absence/unavailability is `undefined`, never an error. */
export interface GooseKeyring { read(env: NodeJS.ProcessEnv): Promise<Readonly<Record<string, string>> | undefined> }

/** Reads the real OS keyring with the operator environment (session bus, keychain).
 * The value is held in memory only, never written or logged; the result is cached per instance
 * so parallel trials prompt or query the keyring at most once. */
export class SystemGooseKeyring implements GooseKeyring {
  private cached?: Promise<Readonly<Record<string, string>> | undefined>;
  private readonly platform: NodeJS.Platform;
  constructor(platform: NodeJS.Platform = process.platform) { this.platform = platform; }
  read(env: NodeJS.ProcessEnv): Promise<Readonly<Record<string, string>> | undefined> {
    this.cached ??= this.load(env);
    return this.cached;
  }
  private load(env: NodeJS.ProcessEnv): Promise<Readonly<Record<string, string>> | undefined> {
    const command = keyringCommand(this.platform);
    if (!command) return Promise.resolve(undefined);
    return new Promise(resolve => {
      // A missing tool, locked keyring, absent entry or timeout all mean "no keyring credential":
      // the child Goose then reports its own provider authentication error.
      execFile(command.executable, command.args, { env, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: OUTPUT_LIMIT, windowsHide: true, shell: false },
        (error, stdout) => resolve(error ? undefined : parseGooseSecrets(stdout)));
    });
  }
}

function disabled(value: string | undefined): boolean {
  return value !== undefined && !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

/** Selected-provider variables to add to the operator environment before isolation.
 * Returns only `<PROVIDER>_*`/alias names absent from `env`, never names the isolation
 * policy refuses. Empty when no keyring, no provider or GOOSE_DISABLE_KEYRING is set. */
export async function providerKeyringEnvironment(keyring: GooseKeyring | undefined, env: NodeJS.ProcessEnv, provider: string | undefined): Promise<Record<string, string>> {
  if (!keyring || provider === undefined || disabled(env.GOOSE_DISABLE_KEYRING)) return {};
  const allowed = providerAllows(provider);
  const secrets = await keyring.read(env);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets ?? {})) {
    if (env[key] === undefined && allowed(key) && !neverForwardName(key) && !/^GOOSE_/i.test(key)) result[key] = value;
  }
  return result;
}

/** Registers forwarded keyring values with the stored-secret rule used for Goose
 * secrets.yaml (>=6 characters, any name), not the name-based environment rule: keyring
 * entries hold the same data class, so short or oddly named values must still be redacted. */
export function registerKeyringCredentials(values: Readonly<Record<string, string>>, destination: Set<string>): void {
  for (const value of Object.values(values)) if (plausibleStoredSecret(value)) destination.add(value);
}
