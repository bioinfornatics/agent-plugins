#!/usr/bin/env node
/** Versioned privacy, redaction, retention, and protected-artifact policy. */
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

export const PRIVACY_POLICY_SCHEMA = "agent-creator.privacy-policy/v1" as const;
export const PROTECTED_REF_SCHEMA = "agent-creator.protected-ref/v2" as const;
export const TOMBSTONE_SCHEMA = "agent-creator.protected-tombstone/v2" as const;
export const INTEGRITY_LEDGER_SCHEMA = "agent-creator.integrity-ledger/v1" as const;
export const INTEGRITY_HEAD_SCHEMA = "agent-creator.integrity-head/v1" as const;
export const REDACTED = "[REDACTED]";

export const PRIVACY_POLICY = Object.freeze({
  schema_version: PRIVACY_POLICY_SCHEMA,
  classifications: Object.freeze({
    metadata: "Operational counts, timestamps, public identifiers, hashes, and declared secret names; suitable for aggregate evidence after redaction.",
    content: "Prompts, responses, transcripts, notes, and source excerpts; retain only when explicitly configured.",
    protected_artifact: "Credentials, proprietary fixtures, or content requiring access control; store by content hash and reference from manifests.",
  }),
  defaults: Object.freeze({ transcript_retention: "retain", protected_artifact_ttl_seconds: 86400 }),
});

export type TranscriptRetention = "retain" | "delete-after-aggregate";
export interface RetentionPolicy { transcriptRetention: TranscriptRetention; protectedArtifactTtlSeconds: number; }
export interface ProtectedArtifactRef {
  schema_version: typeof PROTECTED_REF_SCHEMA;
  classification: "protected_artifact";
  digest: `sha256:${string}`;
  byte_length: number;
  created_at: string;
  expires_at: string;
  secret_names?: string[];
  metadata_hash: `sha256:${string}`;
}
export interface ArtifactStatus { available: boolean; reason?: "deleted" | "expired" | "missing" | "invalid"; ref?: ProtectedArtifactRef; }

export class PrivacyDiagnostic extends Error {
  constructor(public readonly code: string, message: string) { super(`${code}: ${message}`); this.name = "PrivacyDiagnostic"; }
}

const SECRET_KEY = /(?:prompt|content|message|response|output|input|secret|password|passwd|pwd|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|credential|cookie|session)/i;
const ASSIGNMENT_KEY = String.raw`(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|accountkey|sharedaccesskey|sharedaccesssignature|clientsecret|client_secret|connectionstring|authorization|sig|[A-Za-z_][A-Za-z0-9_.-]*_(?:credential|credentials|secret|secrets|password|passwd|pwd|token|key))`;
const DECLARED_SECRET_NAMES_KEY = /^(?:required_)?secret_names$/i;
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const PRIVATE_PATHS: RegExp[] = [
  /(["'])(?:file:\/{2,3})?(?:\/(?:home|Users|root|private\/var\/folders)\/|[A-Za-z]:[\\/]+Users[\\/]+)[^"'\r\n]+\1/g,
  /(?:file:\/{2,3})?(?:\/(?:home|Users|root|private\/var\/folders)\/|[A-Za-z]:[\\/]+Users[\\/]+)[^\r\n<>|;]+/g,
];
const VALUE_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,255}\b/g,
  /\b(?:xox(?:a|b|p|r|s)|xapp)-[A-Za-z0-9-]{10,}\b/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_\/-]+/gi,
  /\bnpm_[A-Za-z0-9]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bya29\.[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:sk|rk)-(?:live|test)-[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}\b/gi,
  new RegExp(String.raw`\b(${ASSIGNMENT_KEY}\s*[:=]\s*)("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;&#]+)`, "gi"),
  /\b((?:https?|ftp|mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?):\/\/)[^\s\/@:]+:[^\s\/@]+@/gi,
];

/** Total, bounded string redaction. Valid JSON is parsed before any text fallback,
 * so credential-bearing fields cannot hide inside an escaped response string. */
export function redactString(input: unknown): string {
  let text: string;
  try { text = typeof input === "string" ? input : String(input ?? ""); } catch { return REDACTED; }
  try {
    text = text.slice(0, 1_000_000);
    const trimmed = text.trim();
    if (trimmed && /^[{[]/.test(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(redactValue(parsed, { topLevel: false }));
      } catch { /* malformed JSON and YAML continue through fail-safe text patterns */ }
    }
    for (const pattern of PRIVATE_PATHS) { pattern.lastIndex = 0; text = text.replace(pattern, match => { const quote = /^["']/.test(match) ? match[0] : ""; return quote ? `${quote}[PRIVATE_PATH]${quote}` : "[PRIVATE_PATH]"; }); }
    for (const pattern of VALUE_PATTERNS) {
      pattern.lastIndex = 0;
      text = text.replace(pattern, (_match, prefix) => typeof prefix === "string" ? `${prefix}${REDACTED}` : REDACTED);
    }
    return text;
  } catch { return REDACTED; }
}

/** Total, cycle-safe redaction. It never invokes getters and stops at bounded depth/size. */
export function redactValue(value: unknown, options: { topLevel?: boolean; maxDepth?: number; maxNodes?: number; redactProtectedKeys?: boolean } = {}): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const maxDepth = Math.max(0, Math.min(64, Number.isFinite(options.maxDepth) ? Number(options.maxDepth) : 16));
  const maxNodes = Math.max(1, Math.min(100_000, Number.isFinite(options.maxNodes) ? Number(options.maxNodes) : 10_000));
  const visit = (current: unknown, depth: number, top: boolean): unknown => {
    try {
      if (++nodes > maxNodes || depth > maxDepth) return REDACTED;
      if (current === null || current === undefined) return null;
      if (typeof current === "string") return top ? REDACTED : redactString(current);
      if (typeof current === "number" || typeof current === "boolean") return top ? REDACTED : current;
      if (typeof current === "bigint" || typeof current === "symbol" || typeof current === "function") return REDACTED;
      if (typeof current !== "object") return REDACTED;
      if (seen.has(current)) return REDACTED;
      seen.add(current);
      if (Array.isArray(current)) {
        const length = Math.min(current.length, 10_000), output: unknown[] = [];
        for (let index = 0; index < length; index++) output.push(visit(Object.getOwnPropertyDescriptor(current, String(index))?.value, depth + 1, false));
        return output;
      }
      const output: Record<string, unknown> = {};
      const descriptors = Object.getOwnPropertyDescriptors(current);
      for (const key of Object.keys(descriptors).sort().slice(0, 10_000)) {
        const descriptor = descriptors[key];
        if (DECLARED_SECRET_NAMES_KEY.test(key) && "value" in descriptor) {
          const names = descriptor.value;
          output[redactString(key)] = Array.isArray(names) ? names.map(name => typeof name === "string" && SECRET_NAME.test(name) ? name : REDACTED) : REDACTED;
        } else output[redactString(key)] = (options.redactProtectedKeys !== false && SECRET_KEY.test(key)) || !("value" in descriptor) ? REDACTED : visit(descriptor.value, depth + 1, false);
      }
      return output;
    } catch { return REDACTED; }
  };
  return visit(value, 0, options.topLevel ?? true);
}

export function parseRetentionPolicy(input: unknown): RetentionPolicy {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PrivacyDiagnostic("INVALID_POLICY", "policy must be an object");
  const value = input as Record<string, unknown>;
  if (value.schema_version !== undefined && value.schema_version !== PRIVACY_POLICY_SCHEMA) throw new PrivacyDiagnostic("INVALID_POLICY", `schema_version must be ${PRIVACY_POLICY_SCHEMA}`);
  const transcriptRetention = value.transcript_retention ?? "retain";
  const ttl = value.protected_artifact_ttl_seconds ?? 86400;
  if (transcriptRetention !== "retain" && transcriptRetention !== "delete-after-aggregate") throw new PrivacyDiagnostic("INVALID_POLICY", "transcript_retention must be retain or delete-after-aggregate");
  if (typeof ttl !== "number" || !Number.isSafeInteger(ttl) || ttl < 1 || ttl > 31_536_000) throw new PrivacyDiagnostic("INVALID_POLICY", "protected_artifact_ttl_seconds must be an integer from 1 to 31536000");
  return { transcriptRetention, protectedArtifactTtlSeconds: ttl };
}

function hash(content: Buffer | string): string { return createHash("sha256").update(content).digest("hex"); }
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${canonical((value as any)[key])}`).join(",")}}`;
}
function isoMillis(input: string | number | Date): number {
  const value = input instanceof Date ? input.getTime() : typeof input === "number" ? input : Date.parse(input);
  if (!Number.isFinite(value)) throw new PrivacyDiagnostic("INVALID_TIME", "time must be a valid date");
  return value;
}
function digestOf(input: unknown): string {
  if (typeof input !== "string" || !/^sha256:[a-f0-9]{64}$/.test(input)) throw new PrivacyDiagnostic("INVALID_REF", "digest must be sha256:<64 lowercase hex>");
  return input.slice(7);
}
function rootPath(workspace: string): string { return join(resolve(workspace), ".agent-creator-protected"); }
function assertNoSymlink(root: string, target: string, allowMissingLeaf = false): void {
  const base = resolve(root), resolved = resolve(target), rel = relative(base, resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel === "" && resolved !== base) throw new PrivacyDiagnostic("PATH_ESCAPE", "protected path escapes its root");
  let cursor = base;
  const parts = rel ? rel.split(sep) : [];
  for (let i = 0; i < parts.length; i++) {
    cursor = join(cursor, parts[i]);
    try { if (lstatSync(cursor).isSymbolicLink()) throw new PrivacyDiagnostic("SYMLINK", "symlinks are forbidden in the protected store"); }
    catch (error: any) { if (error instanceof PrivacyDiagnostic) throw error; if (error?.code !== "ENOENT" || !(allowMissingLeaf || i < parts.length)) throw error; }
  }
}
function ensureRoot(workspace: string): string {
  const root = rootPath(workspace), parent = dirname(root);
  assertNoSymlink(parent, root, true); mkdirSync(root, { recursive: true, mode: 0o700 }); chmodSync(root, 0o700); assertNoSymlink(parent, root); return root;
}
function metadataPath(root: string, digest: string): string { return join(root, "metadata", digest + ".json"); }
function ledgerPath(root: string, kind: "metadata" | "tombstone"): string { return join(root, `${kind}-ledger.jsonl`); }
function headPath(root: string, kind: "metadata" | "tombstone"): string { return join(root, `${kind}-head.json`); }
const GENESIS_HASH = "0".repeat(64);
type LedgerKind = "metadata" | "tombstone";
type LedgerEntry = { schema_version: typeof INTEGRITY_LEDGER_SCHEMA; kind: LedgerKind; sequence: number; prev_hash: string; payload: Record<string, unknown>; entry_hash: string };
function atomicCheckpoint(root: string, kind: LedgerKind, sequence: number, headHash: string): void {
  const target = headPath(root, kind), temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  assertNoSymlink(root, target, true); assertNoSymlink(root, temp, true);
  const fd = openSync(temp, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify({ schema_version: INTEGRITY_HEAD_SCHEMA, kind, sequence, head_hash: headHash }) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, target); chmodSync(target, 0o600);
  const dirFd = openSync(root, "r"); try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
}
function verifyLedger(root: string, kind: LedgerKind): LedgerEntry[] {
  const log = ledgerPath(root, kind), checkpoint = headPath(root, kind);
  if (!existsSync(log) && !existsSync(checkpoint)) return [];
  if (!existsSync(log) || !existsSync(checkpoint)) throw new PrivacyDiagnostic("INTEGRITY_FAILURE", `${kind} ledger or durable head checkpoint is missing`);
  assertNoSymlink(root, log); assertNoSymlink(root, checkpoint);
  let head: any;
  try { head = JSON.parse(readFileSync(checkpoint, "utf8")); } catch { throw new PrivacyDiagnostic("INTEGRITY_FAILURE", `${kind} head checkpoint is invalid`); }
  const lines = readFileSync(log, "utf8").split("\n").filter(Boolean), entries: LedgerEntry[] = [];
  let previous = GENESIS_HASH;
  for (let index = 0; index < lines.length; index++) {
    let entry: any; try { entry = JSON.parse(lines[index]); } catch { throw new PrivacyDiagnostic("INTEGRITY_FAILURE", `${kind} ledger is invalid JSONL`); }
    if (entry?.schema_version !== INTEGRITY_LEDGER_SCHEMA || entry.kind !== kind || entry.sequence !== index + 1 || entry.prev_hash !== previous || !entry.payload || typeof entry.payload !== "object" || Array.isArray(entry.payload)) throw new PrivacyDiagnostic("INTEGRITY_FAILURE", `${kind} ledger chain is invalid`);
    const unsigned = { schema_version: entry.schema_version, kind: entry.kind, sequence: entry.sequence, prev_hash: entry.prev_hash, payload: entry.payload };
    const expected = hash(canonical(unsigned));
    if (entry.entry_hash !== expected) throw new PrivacyDiagnostic("INTEGRITY_FAILURE", `${kind} ledger content hash is invalid`);
    previous = expected; entries.push(entry as LedgerEntry);
  }
  if (head?.schema_version !== INTEGRITY_HEAD_SCHEMA || head.kind !== kind || head.sequence !== entries.length || head.head_hash !== previous) throw new PrivacyDiagnostic("INTEGRITY_FAILURE", `${kind} ledger was changed or truncated relative to its durable head`);
  return entries;
}
function appendLedger(root: string, kind: LedgerKind, payload: Record<string, unknown>): LedgerEntry {
  const entries = verifyLedger(root, kind), sequence = entries.length + 1, prev_hash = entries.at(-1)?.entry_hash ?? GENESIS_HASH;
  const unsigned = { schema_version: INTEGRITY_LEDGER_SCHEMA, kind, sequence, prev_hash, payload };
  const entry: LedgerEntry = { ...unsigned, entry_hash: hash(canonical(unsigned)) };
  const log = ledgerPath(root, kind); assertNoSymlink(root, log, true);
  const fd = openSync(log, "a", 0o600); try { writeFileSync(fd, JSON.stringify(entry) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  chmodSync(log, 0o600); atomicCheckpoint(root, kind, sequence, entry.entry_hash); return entry;
}
function validateSecretNames(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(name => typeof name === "string" && SECRET_NAME.test(name))) throw new PrivacyDiagnostic("INVALID_SECRET_NAME", "secret names must match [A-Za-z_][A-Za-z0-9_]*, never values");
  const names = [...new Set(value as string[])].sort(); return names.length ? names : undefined;
}
function refCore(ref: Omit<ProtectedArtifactRef, "metadata_hash"> | ProtectedArtifactRef): Record<string, unknown> {
  const { metadata_hash: _ignored, ...core } = ref as ProtectedArtifactRef; return core;
}
function canonicalRef(root: string, digest: string): ProtectedArtifactRef {
  const path = metadataPath(root, digest); assertNoSymlink(root, path);
  if (!existsSync(path)) throw new PrivacyDiagnostic("INVALID_REF", "trusted retention metadata is missing");
  let ref: any; try { ref = JSON.parse(readFileSync(path, "utf8")); } catch { throw new PrivacyDiagnostic("INVALID_REF", "trusted retention metadata is invalid"); }
  if (ref?.schema_version !== PROTECTED_REF_SCHEMA || ref?.classification !== "protected_artifact" || ref?.digest !== `sha256:${digest}` || !Number.isSafeInteger(ref?.byte_length) || ref.byte_length < 0 || !/^sha256:[a-f0-9]{64}$/.test(ref?.metadata_hash)) throw new PrivacyDiagnostic("INVALID_REF", "trusted retention metadata is invalid");
  isoMillis(ref.created_at); isoMillis(ref.expires_at); validateSecretNames(ref.secret_names);
  const expectedMetadataHash = `sha256:${hash(canonical(refCore(ref)))}`;
  if (ref.metadata_hash !== expectedMetadataHash) throw new PrivacyDiagnostic("INTEGRITY_FAILURE", "protected metadata content was changed");
  const entries = verifyLedger(root, "metadata");
  const matches = entries.filter(entry => entry.payload.digest === ref.digest);
  if (matches.length !== 1 || matches[0].payload.metadata_hash !== expectedMetadataHash) throw new PrivacyDiagnostic("INTEGRITY_FAILURE", "protected metadata is not bound to the integrity ledger");
  return ref as ProtectedArtifactRef;
}
function sameReference(candidate: unknown, trusted: ProtectedArtifactRef): boolean {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  return canonical(candidate) === canonical(trusted);
}
function readTombstones(root: string): Set<string> {
  const entries = verifyLedger(root, "tombstone"), result = new Set<string>();
  for (const entry of entries) {
    const item = entry.payload;
    if (item?.schema_version !== TOMBSTONE_SCHEMA || typeof item.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(item.digest)) throw new PrivacyDiagnostic("INTEGRITY_FAILURE", "tombstone payload is invalid");
    result.add(item.digest);
  }
  return result;
}

export function putProtectedArtifact(workspace: string, content: Buffer | string, options: { now?: string | number | Date; ttlSeconds?: number; secretNames?: string[] } = {}): ProtectedArtifactRef {
  if (!(typeof content === "string" || Buffer.isBuffer(content))) throw new PrivacyDiagnostic("INVALID_CONTENT", "content must be a string or Buffer");
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content), ttl = options.ttlSeconds ?? 86400;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 31_536_000) throw new PrivacyDiagnostic("INVALID_EXPIRY", "ttlSeconds must be an integer from 1 to 31536000");
  const names = validateSecretNames(options.secretNames), now = isoMillis(options.now ?? Date.now()), digest = hash(bytes), root = ensureRoot(workspace), objects = join(root, "objects"), metadata = join(root, "metadata"), path = join(objects, digest);
  mkdirSync(objects, { recursive: true, mode: 0o700 }); mkdirSync(metadata, { recursive: true, mode: 0o700 }); assertNoSymlink(root, objects); assertNoSymlink(root, metadata); assertNoSymlink(root, path, true);
  if (!existsSync(path)) { const fd = openSync(path, "wx", 0o600); try { writeFileSync(fd, bytes); } finally { closeSync(fd); } }
  else if (hash(readFileSync(path)) !== digest) throw new PrivacyDiagnostic("HASH_MISMATCH", "existing protected object does not match its digest");
  const record = metadataPath(root, digest); assertNoSymlink(root, record, true);
  if (existsSync(record)) return canonicalRef(root, digest);
  const core: Omit<ProtectedArtifactRef, "metadata_hash"> = { schema_version: PROTECTED_REF_SCHEMA, classification: "protected_artifact", digest: `sha256:${digest}`, byte_length: bytes.length, created_at: new Date(now).toISOString(), expires_at: new Date(now + ttl * 1000).toISOString(), ...(names ? { secret_names: names } : {}) };
  const ref: ProtectedArtifactRef = { ...core, metadata_hash: `sha256:${hash(canonical(core))}` };
  appendLedger(root, "metadata", { digest: ref.digest, metadata_hash: ref.metadata_hash });
  const fd = openSync(record, "wx", 0o600); try { writeFileSync(fd, JSON.stringify(ref) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  return canonicalRef(root, digest);
}

export function protectedArtifactStatus(workspace: string, ref: unknown, now: string | number | Date = Date.now()): ArtifactStatus {
  try {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return { available: false, reason: "invalid" };
    const digest = digestOf((ref as any).digest), root = ensureRoot(workspace), trusted = canonicalRef(root, digest);
    if (!sameReference(ref, trusted)) return { available: false, reason: "invalid" };
    const tombstones = readTombstones(root);
    if (isoMillis(trusted.expires_at) <= isoMillis(now)) return { available: false, reason: "expired" };
    if (tombstones.has(trusted.digest)) return { available: false, reason: "deleted" };
    const path = join(root, "objects", digest); assertNoSymlink(root, path);
    if (!existsSync(path)) return { available: false, reason: "missing" };
    const bytes = readFileSync(path);
    if (bytes.length !== trusted.byte_length || hash(bytes) !== digest) return { available: false, reason: "missing" };
    return { available: true, ref: trusted };
  } catch { return { available: false, reason: "invalid" }; }
}

export function readProtectedArtifact(workspace: string, ref: unknown, now: string | number | Date = Date.now()): Buffer {
  const status = protectedArtifactStatus(workspace, ref, now);
  if (!status.available || !status.ref) throw new PrivacyDiagnostic("CLAIM_UNAVAILABLE", `protected evidence is unavailable (${status.reason ?? "invalid"})`);
  const root = ensureRoot(workspace), path = join(root, "objects", digestOf(status.ref.digest)); assertNoSymlink(root, path); return readFileSync(path);
}

/** Deletes bytes and appends an auditable, non-content tombstone; dependent claims become unavailable. */
export function deleteProtectedArtifact(workspace: string, ref: unknown, reason: string, options: { now?: string | number | Date; affectedClaimIds?: string[] } = {}): { deleted: boolean; claim_status: "unavailable"; digest: string } {
  if (typeof reason !== "string" || !reason.trim()) throw new PrivacyDiagnostic("INVALID_REASON", "deletion reason is required");
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw new PrivacyDiagnostic("INVALID_REF", "protected ref must be an object");
  const candidate = ref as ProtectedArtifactRef, digest = digestOf(candidate.digest), root = ensureRoot(workspace), trusted = canonicalRef(root, digest);
  if (!sameReference(candidate, trusted)) throw new PrivacyDiagnostic("INVALID_REF", "protected reference does not match trusted metadata");
  readTombstones(root); // fail closed before changing bytes if the deletion audit chain is damaged
  const path = join(root, "objects", digest); assertNoSymlink(root, path, true); const deleted = existsSync(path);
  const claims = options.affectedClaimIds ?? [];
  if (!claims.every(id => typeof id === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(id))) throw new PrivacyDiagnostic("INVALID_CLAIM", "affected claim ids must be filesystem-neutral identifiers");
  const event = { schema_version: TOMBSTONE_SCHEMA, digest: candidate.digest, deleted_at: new Date(isoMillis(options.now ?? Date.now())).toISOString(), reason: redactString(reason), affected_claims: [...new Set(claims)].sort().map(id => ({ id, status: "unavailable" })) };
  appendLedger(root, "tombstone", event);
  // Audit first: a crash may leave inaccessible bytes for cleanup, never an unaudited deletion.
  if (deleted) rmSync(path);
  return { deleted, claim_status: "unavailable", digest: candidate.digest };
}

function usage(): never { console.error("usage:\n  privacy_policy.js policy\n  privacy_policy.js redact <text>\n  privacy_policy.js put --workspace <dir> --file <path> [--ttl-seconds <n>] [--secret-name <name> ...]\n  privacy_policy.js status --workspace <dir> --ref <ref.json> [--now <date>]\n  privacy_policy.js delete --workspace <dir> --ref <ref.json> --reason <text> [--claim <id> ...]"); process.exit(2); }
export function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (command === "policy") { console.log(JSON.stringify(PRIVACY_POLICY, null, 2)); return; }
  if (command === "redact") { console.log(redactString(args.join(" "))); return; }
  const parsed = parseArgs({ args, options: { workspace: { type: "string" }, file: { type: "string" }, ref: { type: "string" }, "ttl-seconds": { type: "string" }, "secret-name": { type: "string", multiple: true }, reason: { type: "string" }, claim: { type: "string", multiple: true }, now: { type: "string" } }, strict: true });
  if (!parsed.values.workspace) usage();
  if (command === "put" && parsed.values.file) { const ref = putProtectedArtifact(parsed.values.workspace, readFileSync(resolve(parsed.values.file)), { ttlSeconds: parsed.values["ttl-seconds"] === undefined ? undefined : Number(parsed.values["ttl-seconds"]), secretNames: parsed.values["secret-name"] }); console.log(JSON.stringify(ref, null, 2)); return; }
  if ((command === "status" || command === "delete") && parsed.values.ref) { const ref = JSON.parse(readFileSync(resolve(parsed.values.ref), "utf8")); if (command === "status") console.log(JSON.stringify(protectedArtifactStatus(parsed.values.workspace, ref, parsed.values.now))); else { if (!parsed.values.reason) usage(); console.log(JSON.stringify(deleteProtectedArtifact(parsed.values.workspace, ref, parsed.values.reason, { affectedClaimIds: parsed.values.claim, now: parsed.values.now }), null, 2)); } return; }
  usage();
}
if (!import.meta.url.includes("/$bunfs/") && import.meta.url === `file://${process.argv[1]}`) try { main(); } catch (error) { console.error(error instanceof Error ? error.message : "privacy operation failed"); process.exit(1); }
