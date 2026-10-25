import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
export const MANIFEST_VERSION = "hook-evaluation-run-manifest/v1";
const sha = (x) => createHash("sha256").update(x).digest("hex");
const plain = (x) => x !== null && typeof x === "object" && !Array.isArray(x) && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
function die(x) { throw Error(x); }
export function canonicalSerialize(value, omit = false) { const seen = new Set(); const v = (x, root = false) => { if (x === null)
    return "null"; if (typeof x === "string" || typeof x === "boolean")
    return JSON.stringify(x); if (typeof x === "number") {
    if (!Number.isFinite(x))
        die("non-finite number");
    return JSON.stringify(x);
} if (typeof x !== "object")
    die("non-JSON value"); if (seen.has(x))
    die("cycle"); seen.add(x); let out; if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++)
        if (!(i in x))
            die("sparse array");
    out = "[" + x.map(y => v(y)).join(",") + "]";
}
else {
    if (!plain(x))
        die("non-plain object");
    out = "{" + Object.keys(x).filter(k => !(root && omit && k === "canonical_content_sha256")).sort().map(k => JSON.stringify(k) + ":" + v(x[k])).join(",") + "}";
} seen.delete(x); return out; }; return v(value, true); }
export const canonicalManifestHash = (x) => sha(canonicalSerialize(x, true));
function obj(x, f, req, opt = []) { if (!plain(x))
    die(f + " must be object"); const allow = new Set([...req, ...opt]); for (const k of Object.keys(x)) {
    if (!allow.has(k))
        die(f + " unsupported " + k);
    if (k !== "secret_names" && /secret|token|password|credential|api[_-]?key/i.test(k))
        die("secret values forbidden");
} for (const k of req)
    if (!(k in x))
        die(f + " missing " + k); return x; }
function text(x, f) { if (typeof x !== "string" || !x.trim())
    die(f + " must be non-empty"); return x; }
function arr(x, f, min = 0) { if (!Array.isArray(x) || x.length < min)
    die(f + " required"); return x; }
function ref(x) { const p = text(x, "canonical_ref"); if (isAbsolute(p) || p.includes("\\") || p.split("/").some((q) => !q || q === "." || q === ".."))
    die("canonical refs must be normalized relative paths"); return p; }
function baseRef(x) { const p = text(x, "path_base"); if (!isAbsolute(p) || resolve(p) !== p)
    die("path_base must be a canonical absolute directory"); return p; }
function base(x) { const p = baseRef(x); if (realpathSync(p) !== p || !lstatSync(p).isDirectory())
    die("path_base must be an existing canonical absolute directory"); return p; }
function boundary(x, f, set) { const id = text(x, f); if (!set.has(id))
    die(f + " references unknown trust boundary"); return id; }
function availableRuntime(x, f, set, extra = []) { x = obj(x, f, ["name", "trust_boundary"], ["version", "unavailable_reason", ...extra]); if (("version" in x) === ("unavailable_reason" in x))
    die(f + " requires exactly one version or unavailable_reason"); return { name: text(x.name, f + ".name"), ...("version" in x ? { version: text(x.version, f + ".version") } : { unavailable_reason: text(x.unavailable_reason, f + ".unavailable_reason") }), trust_boundary: boundary(x.trust_boundary, f + ".trust_boundary", set) }; }
function link(root, p) { const canonical_ref = ref(p), a = resolve(root, canonical_ref), r = relative(root, a); if (r === ".." || r.startsWith(".." + sep))
    die("path escape"); let cursor = root; for (const part of canonical_ref.split("/")) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink())
        die("symlink rejected");
} const s = lstatSync(a); let kind, digest; if (s.isFile()) {
    kind = "file";
    digest = sha(readFileSync(a));
}
else if (s.isDirectory()) {
    kind = "directory";
    const e = [];
    const walk = (d) => { for (const n of readdirSync(d).sort()) {
        const f = join(d, n), q = lstatSync(f);
        if (q.isSymbolicLink())
            die("symlink rejected");
        if (q.isDirectory())
            walk(f);
        else if (q.isFile())
            e.push({ canonical_ref: relative(a, f).split(sep).join("/"), sha256: sha(readFileSync(f)) });
        else
            die("unsupported entry");
    } };
    walk(a);
    digest = sha(canonicalSerialize(e));
}
else
    die("input must be file or directory"); return { canonical_ref, kind, sha256: digest, uri: "sha256:" + digest }; }
function unavailable(x, f) { x = obj(x, f, ["unavailable_reason"]); return { unavailable_reason: text(x.unavailable_reason, f + ".unavailable_reason") }; }
export function validateEvaluationRunSpec(raw) { const req = ["artifact", "scenarios", "fixtures", "plan", "host_adapter", "models", "tools", "budgets", "runner", "graders", "source_control", "timestamps", "secret_names", "trust_boundaries", "environment"], x = obj(raw, "spec", req, ["baseline", "baseline_unavailable_reason"]); if (("baseline" in x) === ("baseline_unavailable_reason" in x))
    die("spec requires exactly one baseline or baseline_unavailable_reason"); [x.artifact, x.scenarios, x.plan, ...arr(x.fixtures, "fixtures", 1)].forEach(ref); if ("baseline" in x)
    ref(x.baseline);
else
    text(x.baseline_unavailable_reason, "baseline_unavailable_reason"); const bs = arr(x.trust_boundaries, "trust_boundaries", 1).map(v => text(v, "trust boundary")); if (new Set(bs).size !== bs.length)
    die("trust boundaries must be unique"); const set = new Set(bs); x.host_adapter = availableRuntime(x.host_adapter, "host_adapter", set); x.runner = availableRuntime(x.runner, "runner", set); x.models = arr(x.models, "models", 1).map(m => { m = obj(m, "model", ["role", "requested", "trust_boundary"], ["resolved", "unavailable_reason"]); if (("resolved" in m) === ("unavailable_reason" in m))
    die("model requires exactly one resolved or unavailable_reason"); return { role: text(m.role, "model.role"), requested: text(m.requested, "model.requested"), ...("resolved" in m ? { resolved: text(m.resolved, "model.resolved") } : { unavailable_reason: text(m.unavailable_reason, "model.unavailable_reason") }), trust_boundary: boundary(m.trust_boundary, "model.trust_boundary", set) }; }); x.tools = arr(x.tools, "tools").map(t => { t = obj(t, "tool", ["name", "trust_boundary"], ["version", "unavailable_reason"]); if (("version" in t) === ("unavailable_reason" in t))
    die("tool requires exactly one version or unavailable_reason"); return { name: text(t.name, "tool.name"), ...("version" in t ? { version: text(t.version, "tool.version") } : { unavailable_reason: text(t.unavailable_reason, "tool.unavailable_reason") }), trust_boundary: boundary(t.trust_boundary, "tool.trust_boundary", set) }; }); x.graders = arr(x.graders, "graders", 1).map(g => { const raw = obj(g, "grader", ["name", "trust_boundary"], ["version", "unavailable_reason", "model_role"]), runtime = availableRuntime(raw, "grader", set, ["model_role"]); return { ...runtime, ...("model_role" in raw ? { model_role: text(raw.model_role, "grader.model_role") } : {}) }; }); if (!plain(x.budgets) || !Object.keys(x.budgets).length)
    die("budgets required"); for (const [k, v] of Object.entries(x.budgets))
    if (!k.trim() || typeof v !== "number" || !Number.isFinite(v) || v < 0)
        die("invalid budget"); const sc = obj(x.source_control, "source_control", ["commit", "dirty"]); if (typeof sc.commit !== "string" || !/^[a-f0-9]{7,64}$/.test(sc.commit) || typeof sc.dirty !== "boolean")
    die("invalid commit/dirty"); const ts = obj(x.timestamps, "timestamps", ["created_at"], ["started_at", "finished_at"]); for (const v of Object.values(ts))
    if (typeof v !== "string" || !v.endsWith("Z") || Number.isNaN(Date.parse(v)))
        die("invalid timestamp"); const names = arr(x.secret_names, "secret_names"); if (names.some(n => typeof n !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(n)) || new Set(names).size !== names.length)
    die("secret names only and unique"); if (!["local", "ci"].includes(x.environment))
    die("environment local or ci"); return x; }
export function createEvaluationRunManifest(raw, root) { const s = validateEvaluationRunSpec(raw), path_base = realpathSync(resolve(root)), inputs = { path_base, artifact: link(path_base, s.artifact), baseline: "baseline" in s ? link(path_base, s.baseline) : { unavailable_reason: s.baseline_unavailable_reason }, scenarios: link(path_base, s.scenarios), fixtures: s.fixtures.map((p) => link(path_base, p)), plan: link(path_base, s.plan) }, m = { schema_version: MANIFEST_VERSION, canonical_content_sha256: "", input_fingerprint_sha256: sha(canonicalSerialize(inputs)), inputs, execution: { environment: s.environment, host_adapter: s.host_adapter, models: s.models, tools: s.tools, budgets: s.budgets, runner: s.runner, graders: s.graders }, provenance: { source_control: s.source_control, timestamps: s.timestamps, secret_names: [...s.secret_names].sort(), trust_boundaries: [...s.trust_boundaries].sort() } }; validateEvaluationRunManifest(m, false); m.canonical_content_sha256 = canonicalManifestHash(m); return m; }
function validLink(x, f) { x = obj(x, f, ["canonical_ref", "kind", "sha256", "uri"]); ref(x.canonical_ref); if (!["file", "directory"].includes(x.kind))
    die(f + " invalid kind"); if (typeof x.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(x.sha256) || x.uri !== "sha256:" + x.sha256)
    die(f + " invalid content link"); return x; }
export function validateEvaluationRunManifest(raw, requireHash = true) { const m = obj(raw, "manifest", ["schema_version", "canonical_content_sha256", "input_fingerprint_sha256", "inputs", "execution", "provenance"]); if (m.schema_version !== MANIFEST_VERSION)
    die("unsupported schema"); if (typeof m.canonical_content_sha256 !== "string" || (requireHash ? !/^[a-f0-9]{64}$/.test(m.canonical_content_sha256) : m.canonical_content_sha256 !== ""))
    die("invalid manifest hash"); if (typeof m.input_fingerprint_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(m.input_fingerprint_sha256))
    die("invalid input fingerprint"); const i = obj(m.inputs, "inputs", ["path_base", "artifact", "baseline", "scenarios", "fixtures", "plan"]); baseRef(i.path_base); validLink(i.artifact, "inputs.artifact"); validLink(i.scenarios, "inputs.scenarios"); validLink(i.plan, "inputs.plan"); arr(i.fixtures, "inputs.fixtures", 1).forEach((v, n) => validLink(v, "inputs.fixtures[" + n + "]")); if (plain(i.baseline) && "unavailable_reason" in i.baseline)
    unavailable(i.baseline, "inputs.baseline");
else
    validLink(i.baseline, "inputs.baseline"); const p = obj(m.provenance, "provenance", ["source_control", "timestamps", "secret_names", "trust_boundaries"]); validateEvaluationRunSpec({ artifact: i.artifact.canonical_ref, ...("canonical_ref" in i.baseline ? { baseline: i.baseline.canonical_ref } : { baseline_unavailable_reason: i.baseline.unavailable_reason }), scenarios: i.scenarios.canonical_ref, fixtures: i.fixtures.map((v) => v.canonical_ref), plan: i.plan.canonical_ref, ...obj(m.execution, "execution", ["environment", "host_adapter", "models", "tools", "budgets", "runner", "graders"]), ...p }); return m; }
function fresh(m) { const i = m.inputs, r = base(i.path_base); return { path_base: r, artifact: link(r, i.artifact.canonical_ref), baseline: "canonical_ref" in i.baseline ? link(r, i.baseline.canonical_ref) : unavailable(i.baseline, "inputs.baseline"), scenarios: link(r, i.scenarios.canonical_ref), fixtures: i.fixtures.map((v) => link(r, v.canonical_ref)), plan: link(r, i.plan.canonical_ref) }; }
function receipt(x) { x = obj(x, "receipt", ["schema_version", "manifest_sha256", "input_fingerprint_sha256", "status"]); if (x.schema_version !== "hook-evaluation-receipt/v1" || !/^[a-f0-9]{64}$/.test(x.manifest_sha256) || !/^[a-f0-9]{64}$/.test(x.input_fingerprint_sha256) || !["pass", "fail"].includes(x.status))
    die("invalid receipt"); return x; }
export function verifyEvaluationRunManifest(raw, rawReceipt) { const errors = []; let m; try {
    m = validateEvaluationRunManifest(raw);
}
catch (e) {
    return { ok: false, errors: ["invalid manifest: " + e.message] };
} const hash = canonicalManifestHash(m); if (m.canonical_content_sha256 !== hash)
    errors.push("manifest hash mismatch"); try {
    if (sha(canonicalSerialize(fresh(m))) !== m.input_fingerprint_sha256)
        errors.push("evaluation inputs changed; receipt is invalid");
}
catch (e) {
    errors.push("cannot verify provenance: " + e.message);
} if (rawReceipt !== undefined)
    try {
        const r = receipt(rawReceipt);
        if (r.manifest_sha256 !== hash)
            errors.push("receipt manifest hash mismatch");
        if (r.input_fingerprint_sha256 !== m.input_fingerprint_sha256)
            errors.push("receipt input fingerprint mismatch");
    }
    catch (e) {
        errors.push(e.message);
    } return { ok: !errors.length, errors }; }
export function writeEvaluationRunManifest(spec, out) { const m = createEvaluationRunManifest(JSON.parse(readFileSync(spec, "utf8")), dirname(realpathSync(spec))); writeFileSync(out, JSON.stringify(m, null, 2) + "\n", { flag: "wx" }); return m; }
