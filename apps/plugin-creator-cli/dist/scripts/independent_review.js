import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
const stable = (v) => Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}` : JSON.stringify(v);
const deepFreeze = (v) => { if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v))
        deepFreeze(x);
} return v; };
const clone = (v) => JSON.parse(JSON.stringify(v));
const hash = (v) => createHash("sha256").update(stable(v)).digest("hex");
const integer = (name, v, zero = false) => { if (!Number.isInteger(v) || v < (zero ? 0 : 1))
    throw new Error(`${name} must be ${zero ? "a non-negative" : "a positive"} integer`); };
const required = (name, v) => { if (typeof v !== "string" || !v.trim())
    throw new Error(`${name} must be a non-empty string`); return v; };
const stringArray = (name, v) => { if (!Array.isArray(v) || v.some(x => typeof x !== "string" || !x.trim()))
    throw new Error(`${name} must be an array of non-empty strings`); return [...v]; };
const optionalStringArray = (name, v) => v === undefined ? undefined : stringArray(name, v);
export function validateReviewConfig(c) {
    if (!c?.runId || !c.task)
        throw new Error("runId and task are required");
    if (!Array.isArray(c.criteria) || !c.criteria.length)
        throw new Error("at least one frozen criterion is required");
    const ids = new Set();
    for (const x of c.criteria) {
        if (!x.id || !x.text || ids.has(x.id))
            throw new Error("criteria require unique ids and text");
        ids.add(x.id);
    }
    if (!c.approvedContext || ![c.approvedContext.evidence, c.approvedContext.contracts, c.approvedContext.scenarios].every(Array.isArray))
        throw new Error("approvedContext requires evidence, contracts, and scenarios arrays");
    for (const [name, values] of [["evidence", c.approvedContext.evidence], ["contract", c.approvedContext.contracts], ["scenario", c.approvedContext.scenarios]]) {
        const seen = new Set();
        for (const value of values) {
            if (!value?.id || seen.has(value.id))
                throw new Error(`approved ${name} requires unique ids`);
            seen.add(value.id);
        }
    }
    if (!c.matrix)
        throw new Error("matrix is required");
    integer("builders", c.matrix.builders);
    integer("domainChallengers", c.matrix.domainChallengers, true);
    integer("uxChallengers", c.matrix.uxChallengers, true);
    integer("evaluationChallengers", c.matrix.evaluationChallengers, true);
    integer("verifiers", c.matrix.verifiers);
    integer("maxConcurrency", c.matrix.maxConcurrency);
    integer("branchBudgetMs", c.matrix.branchBudgetMs);
    integer("totalBudgetMs", c.matrix.totalBudgetMs);
    return c;
}
/** Copies only the recursively closed public schema; raw host objects are never forwarded. */
function validatedPublic(raw, context, criteria) {
    const record = raw && typeof raw === "object" ? raw : undefined;
    const candidate = record?.publicOutput ?? raw;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
        throw new Error("branch response requires publicOutput");
    const p = candidate;
    if (!Array.isArray(p.claims) || !Array.isArray(p.proposedChanges))
        throw new Error("publicOutput requires summary, claims, and proposedChanges");
    const evidence = new Set(context.evidence.map(x => x.id)), criterion = new Set(criteria.map(x => x.id)), contracts = new Set(context.contracts.map(x => x.id)), scenarios = new Set(context.scenarios.map(x => x.id)), ids = new Set();
    const unique = (kind, id) => { if (ids.has(id))
        throw new Error(`duplicate branch claim/change/risk id ${id}`); ids.add(id); };
    const claims = p.claims.map((value, index) => { if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("invalid claim"); const x = value, id = required(`claim[${index}].id`, x.id); unique("claim", id); const evidenceIds = stringArray(`claim ${id} evidenceIds`, x.evidenceIds), criterionIds = stringArray(`claim ${id} criterionIds`, x.criterionIds); for (const ref of evidenceIds)
        if (!evidence.has(ref))
            throw new Error(`claim ${id} references unapproved evidence ${ref}`); for (const ref of criterionIds)
        if (!criterion.has(ref))
            throw new Error(`claim ${id} references unknown criterion ${ref}`); if (x.position !== undefined && !["support", "oppose", "neutral"].includes(x.position))
        throw new Error(`claim ${id} has invalid position`); const contradicts = optionalStringArray(`claim ${id} contradicts`, x.contradicts), risk = x.risk === undefined ? undefined : required(`claim ${id} risk`, x.risk); if (risk && !evidenceIds.length)
        throw new Error(`risk claim ${id} must link at least one approved evidence reference`); return { id, subject: required(`claim ${id} subject`, x.subject), statement: required(`claim ${id} statement`, x.statement), ...(x.position !== undefined ? { position: x.position } : {}), evidenceIds, criterionIds, ...(contradicts ? { contradicts } : {}), ...(risk ? { risk } : {}) }; });
    const proposedChanges = p.proposedChanges.map((value, index) => { if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("invalid proposed change"); const x = value, id = required(`proposedChanges[${index}].id`, x.id); unique("change", id); const evidenceIds = stringArray(`proposed change ${id} evidenceIds`, x.evidenceIds), contractIds = optionalStringArray(`proposed change ${id} contractIds`, x.contractIds), scenarioIds = optionalStringArray(`proposed change ${id} scenarioIds`, x.scenarioIds); if (!evidenceIds.length || (!(contractIds?.length) && !(scenarioIds?.length)))
        throw new Error(`proposed change ${id} must link evidence and a contract or scenario`); for (const ref of evidenceIds)
        if (!evidence.has(ref))
            throw new Error(`proposed change ${id} references unapproved evidence ${ref}`); for (const ref of contractIds || [])
        if (!contracts.has(ref))
            throw new Error(`proposed change ${id} references unknown contract ${ref}`); for (const ref of scenarioIds || [])
        if (!scenarios.has(ref))
            throw new Error(`proposed change ${id} references unknown scenario ${ref}`); return { id, description: required(`proposed change ${id} description`, x.description), evidenceIds, ...(contractIds ? { contractIds } : {}), ...(scenarioIds ? { scenarioIds } : {}) }; });
    const risks = p.risks === undefined ? undefined : (() => { if (!Array.isArray(p.risks))
        throw new Error("risks must be an array"); return p.risks.map((value, index) => { if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("invalid risk"); const x = value, id = required(`risks[${index}].id`, x.id); unique("risk", id); const evidenceIds = stringArray(`risk ${id} evidenceIds`, x.evidenceIds); if (!evidenceIds.length)
        throw new Error(`risk ${id} must link at least one approved evidence reference`); for (const ref of evidenceIds)
        if (!evidence.has(ref))
            throw new Error(`risk ${id} references unapproved evidence ${ref}`); return { id, statement: required(`risk ${id} statement`, x.statement), evidenceIds }; }); })();
    return { summary: required("publicOutput.summary", p.summary), claims, proposedChanges, ...(risks ? { risks } : {}) };
}
function planned(m, verify = false) { const out = []; const add = (role, n) => { for (let i = 1; i <= n; i++)
    out.push({ role, branchId: role + "-" + String(i).padStart(2, "0") }); }; if (verify)
    add("verifier", m.verifiers);
else {
    add("builder", m.builders);
    add("domain-challenger", m.domainChallengers);
    add("ux-challenger", m.uxChallengers);
    add("evaluation-challenger", m.evaluationChallengers);
} return out; }
async function pool(items, limit, fn) { let next = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { for (;;) {
    const i = next++;
    if (i >= items.length)
        return;
    await fn(items[i]);
} })); }
function invalidateClaimLinks(candidates, base = []) {
    const active = () => [...base, ...candidates].filter(x => x.status === "succeeded" && x.publicOutput);
    const duplicateIds = new Set(), owners = new Map();
    for (const branch of active()) {
        const output = branch.publicOutput;
        for (const id of [...output.claims.map(x => x.id), ...output.proposedChanges.map(x => x.id), ...(output.risks || []).map(x => x.id)])
            owners.set(id, [...(owners.get(id) || []), branch]);
    }
    for (const [id, found] of owners)
        if (found.length > 1)
            duplicateIds.add(id);
    for (const branch of candidates.filter(x => x.status === "succeeded" && x.publicOutput)) {
        const output = branch.publicOutput, duplicate = [...output.claims.map(x => x.id), ...output.proposedChanges.map(x => x.id), ...(output.risks || []).map(x => x.id)].find(id => duplicateIds.has(id));
        if (duplicate) {
            branch.status = "failed";
            branch.error = `branch output id ${duplicate} is not unique across branches`;
            delete branch.publicOutput;
        }
    }
    for (;;) {
        const claims = new Map();
        for (const branch of active())
            for (const claim of branch.publicOutput.claims)
                claims.set(claim.id, [...(claims.get(claim.id) || []), { branchId: branch.branchId, claimId: claim.id }]);
        let invalidated = false;
        for (const branch of candidates.filter(x => x.status === "succeeded" && x.publicOutput)) {
            let error;
            for (const claim of branch.publicOutput.claims)
                for (const ref of claim.contradicts || []) {
                    const targets = claims.get(ref) || [];
                    if (targets.length !== 1 || ref === claim.id) {
                        error = `claim ${claim.id} contradicts reference ${ref} does not resolve unambiguously to an existing claim`;
                        break;
                    }
                    if (error)
                        break;
                }
            if (error) {
                branch.status = "failed";
                branch.error = error;
                delete branch.publicOutput;
                invalidated = true;
            }
        }
        if (!invalidated)
            break;
    }
}
export function convergeBranches(branches) {
    const successful = branches.filter(x => x.status === "succeeded" && x.publicOutput).sort((a, b) => a.branchId.localeCompare(b.branchId)), claims = successful.flatMap(b => b.publicOutput.claims.map(c => ({ b, c }))), norm = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
    const groups = new Map();
    for (const x of claims) {
        const k = `${norm(x.c.subject)}\0${norm(x.c.statement)}`;
        groups.set(k, [...(groups.get(k) || []), x]);
    }
    const agreements = [...groups.values()].filter(g => new Set(g.map(x => x.b.branchId)).size > 1).map(g => ({ subject: g[0].c.subject, statement: g[0].c.statement, branchIds: [...new Set(g.map(x => x.b.branchId))].sort(), claimIds: g.map(x => x.c.id).sort(), evidenceIds: [...new Set(g.flatMap(x => x.c.evidenceIds))].sort() })).sort((a, b) => a.subject.localeCompare(b.subject) || a.statement.localeCompare(b.statement));
    const bySubject = new Map();
    for (const x of claims) {
        const k = norm(x.c.subject);
        bySubject.set(k, [...(bySubject.get(k) || []), x]);
    }
    const contradictions = [], seenContradictions = new Set();
    const addContradiction = (subject, g) => { const unique = [...new Map(g.map(x => [x.c.id, x])).values()], key = unique.map(x => x.c.id).sort().join("\0"); if (seenContradictions.has(key))
        return; seenContradictions.add(key); contradictions.push({ subject, claims: unique.map(x => ({ branchId: x.b.branchId, claimId: x.c.id, statement: x.c.statement, position: x.c.position || "neutral", ...(x.c.contradicts?.length ? { contradicts: [...x.c.contradicts] } : {}) })).sort((a, b) => a.branchId.localeCompare(b.branchId) || a.claimId.localeCompare(b.claimId)) }); };
    const byId = new Map(claims.map(x => [x.c.id, x]));
    for (const source of claims)
        for (const targetId of source.c.contradicts || []) {
            const target = byId.get(targetId);
            if (target)
                addContradiction(norm(source.c.subject) === norm(target.c.subject) ? source.c.subject : `${source.c.subject} ↔ ${target.c.subject}`, [source, target]);
        }
    for (const g of bySubject.values()) {
        const positions = new Set(g.map(x => x.c.position).filter(x => x === "support" || x === "oppose"));
        if (positions.size > 1)
            addContradiction(g[0].c.subject, g);
    }
    contradictions.sort((a, b) => a.subject.localeCompare(b.subject));
    const missingEvidence = claims.filter(x => !x.c.evidenceIds.length).map(x => ({ branchId: x.b.branchId, claimId: x.c.id, statement: x.c.statement })).sort((a, b) => a.branchId.localeCompare(b.branchId) || a.claimId.localeCompare(b.claimId));
    const risks = successful.flatMap(b => [...b.publicOutput.claims.filter(c => c.risk).map(c => ({ branchId: b.branchId, id: c.id, statement: c.risk, evidenceIds: [...c.evidenceIds].sort() })), ...(b.publicOutput.risks || []).map(r => ({ branchId: b.branchId, id: r.id, statement: r.statement, evidenceIds: [...r.evidenceIds].sort() }))]).sort((a, b) => a.branchId.localeCompare(b.branchId) || a.id.localeCompare(b.id));
    const proposedChanges = successful.flatMap(b => b.publicOutput.proposedChanges.map(change => ({ branchId: b.branchId, change }))).sort((a, b) => a.branchId.localeCompare(b.branchId) || a.change.id.localeCompare(b.change.id));
    return { agreements, contradictions, missingEvidence, risks, proposedChanges, autoResolved: false };
}
export async function runIndependentReview(config, host) {
    validateReviewConfig(config);
    const started = Date.now(), deadline = started + config.matrix.totalBudgetMs, context = clone(config.approvedContext), criteria = Object.freeze(clone(config.criteria)), approvedContextHash = hash(context), criteriaHash = hash(criteria), branches = [];
    let activeHosts = 0;
    const capacityWaiters = new Set();
    const capacityChanged = () => { for (const wake of capacityWaiters)
        wake(); capacityWaiters.clear(); };
    const waitForCapacityOrDeadline = () => new Promise(resolve => { if (activeHosts < config.matrix.maxConcurrency || Date.now() >= deadline)
        return resolve(); let timer; const wake = () => { clearTimeout(timer); capacityWaiters.delete(wake); resolve(); }; capacityWaiters.add(wake); timer = setTimeout(wake, Math.max(0, deadline - Date.now())); });
    const startBranch = (item, peerOutputs) => {
        const { role, branchId } = item, begin = Date.now(), base = { branchId, role, startedAt: new Date(begin).toISOString(), completedAt: "", durationMs: 0, requestHash: "", approvedContextHash, criteriaHash };
        const request = deepFreeze({ runId: config.runId, branchId, role, approvedContext: clone(context), frozenCriteria: clone(criteria), task: config.task, ...(peerOutputs ? { peerOutputs: clone(peerOutputs) } : {}) });
        base.requestHash = hash(request);
        const controller = new AbortController(), branchDeadline = begin + config.matrix.branchBudgetMs, expires = Math.min(branchDeadline, deadline), timeoutKind = deadline <= branchDeadline ? "total" : "branch";
        let timer;
        activeHosts++;
        const hostSettlement = Promise.resolve().then(() => host.run(request, controller.signal)).then(value => ({ kind: "output", value }), error => ({ kind: "error", error }));
        hostSettlement.finally(() => { activeHosts--; capacityChanged(); });
        const timeout = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ kind: "timeout" }); }, Math.max(0, expires - Date.now())); });
        return Promise.race([hostSettlement, timeout]).then(settled => { if (timer)
            clearTimeout(timer); if (settled.kind === "timeout") {
            base.status = "timed-out";
            base.error = timeoutKind === "total" ? "total budget exhausted" : "branch budget exhausted";
            base.lateOutputQuarantined = true;
        }
        else if (settled.kind === "error") {
            base.status = "failed";
            base.error = settled.error instanceof Error ? settled.error.message : String(settled.error);
        }
        else {
            base.rawOutput = settled.value;
            try {
                base.publicOutput = validatedPublic(settled.value, context, criteria);
                base.status = "succeeded";
            }
            catch (error) {
                base.status = "failed";
                base.error = error instanceof Error ? error.message : String(error);
            }
        } base.durationMs = Date.now() - begin; base.completedAt = new Date().toISOString(); branches.push(base); });
    };
    const skip = (item) => { const now = Date.now(); branches.push({ branchId: item.branchId, role: item.role, status: "skipped-budget", startedAt: new Date(now).toISOString(), completedAt: new Date(now).toISOString(), durationMs: 0, requestHash: "", approvedContextHash, criteriaHash, error: "total budget exhausted or host capacity remained quarantined" }); };
    const runPhase = async (items, peerOutputs) => { const completions = []; let next = 0; while (next < items.length && Date.now() < deadline) {
        while (next < items.length && activeHosts < config.matrix.maxConcurrency && Date.now() < deadline)
            completions.push(startBranch(items[next++], peerOutputs));
        if (next < items.length)
            await waitForCapacityOrDeadline();
    } while (next < items.length)
        skip(items[next++]); await Promise.all(completions); };
    await runPhase(planned(config.matrix));
    const primary = branches.filter(x => x.role !== "verifier");
    invalidateClaimLinks(primary);
    const peers = primary.filter(x => x.status === "succeeded" && x.publicOutput).map(x => ({ branchId: x.branchId, role: x.role, publicOutput: x.publicOutput })).sort((a, b) => a.branchId.localeCompare(b.branchId));
    await runPhase(planned(config.matrix, true), peers);
    const verifiers = branches.filter(x => x.role === "verifier");
    invalidateClaimLinks(verifiers, primary);
    branches.sort((a, b) => a.branchId.localeCompare(b.branchId));
    return { schemaVersion: 1, runId: config.runId, frozen: { approvedContextHash, criteriaHash }, matrix: { ...config.matrix }, branches, convergence: convergeBranches(branches), failuresIsolated: true };
}
export function commandBranchHost(command, args = []) { return { run(request, signal) { return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], signal }), stdout = [], stderr = []; child.stdout.on("data", x => stdout.push(String(x))); child.stderr.on("data", x => stderr.push(String(x))); child.on("error", reject); child.on("close", code => { if (code !== 0)
        return reject(new Error(`branch host exited ${code}: ${stderr.join("").trim()}`)); try {
        resolve(JSON.parse(stdout.join("")));
    }
    catch {
        reject(new Error("branch host returned invalid JSON"));
    } }); child.stdin.end(JSON.stringify(request)); }); } }; }
