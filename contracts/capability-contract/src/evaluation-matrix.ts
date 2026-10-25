import { createHash } from "node:crypto";
import { normalizeEvaluationPlan, canonicalJsonEqual, EvaluationPlanValidationError } from "./evaluation.js";
import type { EvaluationDiagnostic } from "./evaluation-types.js";
import { EVALUATION_MATRIX_PLAN_VERSION, type EvaluationAliasModelRequest, type EvaluationAvailableModel, type EvaluationConcreteModelRequest, type EvaluationHostDefaultRequest, type EvaluationIdentityReceipt, type EvaluationMatrixPlanInput, type EvaluationMatrixPlanV1_1, type EvaluationMatrixRole, type EvaluationModelRequest, type EvaluationResolutionContext, type EvaluationResolutionReceipt } from "./evaluation-matrix-types.js";

const ROLES = ["builder", "challenger", "verifier", "grader"] as const;
const MAX_MODELS_PER_ROLE = 32;
const MAX_IDENTITIES = 128;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 256;
const posInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const diag = (path: string, message: string, remediation: string): EvaluationDiagnostic => ({ code: "EVALUATION_MATRIX_INVALID", path, message, remediation });
const ownOnly = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));

function validRequest(v: unknown): v is EvaluationModelRequest {
  if (!isRecord(v)) return false;
  if (v.hostDefault === true) return ownOnly(v, ["hostDefault", "documentation", "confidence"]) && text(v.documentation) && v.confidence === "host-default";
  if (text(v.alias) && v.confidence === "alias" && v.model === undefined) return ownOnly(v, ["alias", "confidence", "provider"]) && (v.provider === undefined || text(v.provider));
  return ownOnly(v, ["provider", "model", "alias", "confidence"]) && text(v.provider) && text(v.model) && (v.alias === undefined || text(v.alias)) && (v.confidence === undefined || v.confidence === "exact");
}
function normalizeRequest(v: EvaluationModelRequest): EvaluationModelRequest {
  if ("hostDefault" in v) return { hostDefault: true, documentation: v.documentation.trim(), confidence: "host-default" };
  if ("model" in v && v.model !== undefined) return { provider: v.provider.trim(), model: v.model.trim(), ...(v.alias ? { alias: v.alias.trim() } : {}), ...(v.confidence ? { confidence: v.confidence } : {}) };
  return { alias: v.alias.trim(), confidence: "alias", ...(v.provider ? { provider: v.provider.trim() } : {}) };
}
function requestKey(v: EvaluationModelRequest): string { return JSON.stringify(normalizeRequest(v)); }

function validateEvaluationMatrixPlanUnsafe(value: unknown): { valid: boolean; diagnostics: EvaluationDiagnostic[] } {
  const ds: EvaluationDiagnostic[] = [];
  if (!isRecord(value)) return { valid: false, diagnostics: [diag("/", "Evaluation matrix plan must be an object.", "Provide a 1.1.0 evaluation plan.")] };
  if (value.schemaVersion !== EVALUATION_MATRIX_PLAN_VERSION) ds.push(diag("/schemaVersion", "Role-aware matrix plans require schemaVersion 1.1.0.", "Set schemaVersion to 1.1.0."));
  const matrix = value.modelMatrix;
  if (!isRecord(matrix) || !ownOnly(matrix, ["roles", "repetitions", "budgetPerRun", "limits"])) return { valid: false, diagnostics: [...ds, diag("/modelMatrix", "modelMatrix is missing, malformed, or contains unknown fields.", "Declare roles, repetitions, budgetPerRun, and limits only.")] };
  if (!Array.isArray(matrix.roles) || matrix.roles.length !== 4) ds.push(diag("/modelMatrix/roles", "Exactly builder, challenger, verifier, and grader role entries are required.", "Declare each role exactly once; each may contain one or many models."));
  else {
    const seen = new Set<string>(); let identities = 0;
    matrix.roles.forEach((raw, i) => {
      const path = `/modelMatrix/roles/${i}`;
      if (!isRecord(raw) || !ownOnly(raw, ["role", "models", "fallback"]) || !ROLES.includes(raw.role as never) || seen.has(raw.role as string)) ds.push(diag(path, "Role is invalid, duplicated, or contains unknown fields.", "Use each supported role exactly once."));
      else seen.add(raw.role as string);
      for (const field of ["models", "fallback"] as const) {
        const list = raw[field];
        if ((field === "models" && (!Array.isArray(list) || list.length < 1)) || (list !== undefined && (!Array.isArray(list) || list.length > MAX_MODELS_PER_ROLE || list.some((x) => !validRequest(x))))) ds.push(diag(`${path}/${field}`, `${field} must be a bounded list of valid identity requests.`, "Use 1-32 primary models and at most 32 fallbacks."));
        if (Array.isArray(list)) identities += list.length;
      }
    });
    if (identities > MAX_IDENTITIES) ds.push(diag("/modelMatrix/roles", "The matrix exceeds 128 requested identities.", "Reduce primary and fallback identities."));
  }
  if (!posInt(matrix.repetitions) || matrix.repetitions > 1000) ds.push(diag("/modelMatrix/repetitions", "repetitions must be between 1 and 1000.", "Use a bounded positive integer."));
  const b = matrix.budgetPerRun;
  if (!isRecord(b) || !ownOnly(b, ["maxTurns", "timeoutSeconds", "maxTokens", "maxCostUsd"]) || !posInt(b.maxTurns) || b.maxTurns > 1000 || !posInt(b.timeoutSeconds) || b.timeoutSeconds > 86400 || !posInt(b.maxTokens) || b.maxTokens > 10_000_000 || !pos(b.maxCostUsd) || b.maxCostUsd > 10_000) ds.push(diag("/modelMatrix/budgetPerRun", "Every run requires strict turn, timeout, token, and cost bounds within portable ceilings.", "Provide maxTurns, timeoutSeconds, maxTokens, and maxCostUsd."));
  const l = matrix.limits;
  if (!isRecord(l) || !ownOnly(l, ["maxRuns", "maxTurns", "timeoutSeconds", "maxTokens", "maxCostUsd", "concurrency"]) || !posInt(l.maxRuns) || l.maxRuns > 100000 || !posInt(l.maxTurns) || l.maxTurns > 100000000 || !posInt(l.timeoutSeconds) || l.timeoutSeconds > 31536000 || !posInt(l.maxTokens) || l.maxTokens > 1e12 || !pos(l.maxCostUsd) || l.maxCostUsd > 1e6 || !posInt(l.concurrency) || l.concurrency > 1000) ds.push(diag("/modelMatrix/limits", "Matrix totals and concurrency must all be explicit and within portable ceilings.", "Bound runs, turns, timeout, tokens, cost, and concurrency."));
  if (ds.length) return { valid: false, diagnostics: ds };
  const legacy: Record<string, unknown> = { ...value, schemaVersion: "1.0.0" }; delete legacy.modelMatrix; delete legacy.computed;
  const base = normalizeEvaluationPlan(legacy);
  const roleRuns = (matrix.roles as EvaluationMatrixRole[]).reduce((n, r) => n + r.models.length, 0);
  const jobs = base.scenarios.length * base.configurations.length * roleRuns * (matrix.repetitions as number);
  const attempts = base.retries.maxRetries + 1; const runs = jobs * attempts;
  const required = { maxRuns: runs, maxTurns: runs * (b as any).maxTurns, timeoutSeconds: runs * (b as any).timeoutSeconds, maxTokens: runs * (b as any).maxTokens, maxCostUsd: runs * (b as any).maxCostUsd };
  for (const key of Object.keys(required) as (keyof typeof required)[]) if ((l as any)[key] < required[key]) ds.push(diag(`/modelMatrix/limits/${key}`, `Limit is ${(l as any)[key]} but deterministic jobs require ${required[key]}.`, "Raise the bound or reduce the matrix."));
  return { valid: ds.length === 0, diagnostics: ds };
}

export function validateEvaluationMatrixPlan(value: unknown): { valid: boolean; diagnostics: EvaluationDiagnostic[] } {
  try { return validateEvaluationMatrixPlanUnsafe(value); }
  catch { return { valid: false, diagnostics: [diag("/", "Evaluation matrix input could not be safely inspected.", "Provide plain bounded JSON without accessors, proxies, cycles, or exceptional values.")] }; }
}
export function normalizeEvaluationMatrixPlan(value: unknown): EvaluationMatrixPlanV1_1 {
  const checked = validateEvaluationMatrixPlan(value); if (!checked.valid) throw new EvaluationPlanValidationError(checked.diagnostics);
  const input = value as EvaluationMatrixPlanInput; const legacy: any = { ...input, schemaVersion: "1.0.0" }; delete legacy.modelMatrix; delete legacy.computed;
  const base = normalizeEvaluationPlan(legacy); const roles = input.modelMatrix.roles.map((r) => ({ role: r.role, models: r.models.map(normalizeRequest).sort((a,b)=>cmp(requestKey(a),requestKey(b))), ...(r.fallback ? { fallback: r.fallback.map(normalizeRequest).sort((a,b)=>cmp(requestKey(a),requestKey(b))) } : {}) })).sort((a,b)=>cmp(a.role,b.role));
  const roleRuns = roles.reduce((n,r)=>n+r.models.length,0); const totalJobs=base.scenarios.length*base.configurations.length*roleRuns*input.modelMatrix.repetitions; const totalRuns=totalJobs*(base.retries.maxRetries+1); const b=input.modelMatrix.budgetPerRun;
  return { ...base, schemaVersion:EVALUATION_MATRIX_PLAN_VERSION, modelMatrix:{ ...input.modelMatrix, roles }, computed:{ totalJobs,totalRuns,effectiveConcurrency:Math.min(input.modelMatrix.limits.concurrency,totalJobs,input.modelMatrix.limits.maxRuns),requiredBudget:{maxRuns:totalRuns,maxTurns:totalRuns*b.maxTurns,timeoutSeconds:totalRuns*b.timeoutSeconds,maxTokens:totalRuns*b.maxTokens,maxCostUsd:totalRuns*b.maxCostUsd} } };
}
function canonical(v: unknown): unknown { return Array.isArray(v)?v.map(canonical):isRecord(v)?Object.fromEntries(Object.keys(v).sort(cmp).map(k=>[k,canonical(v[k])])):v; }
export function canonicalSerializeEvaluationMatrixPlan(value: unknown): string { return JSON.stringify(canonical(normalizeEvaluationMatrixPlan(value))); }
export function hashEvaluationMatrixPlan(value: unknown): string { return createHash("sha256").update(canonicalSerializeEvaluationMatrixPlan(value)).digest("hex"); }

function resolveOne(req: EvaluationModelRequest, ctx: EvaluationResolutionContext): EvaluationIdentityReceipt | undefined {
  if ("hostDefault" in req) { const d=ctx.hostDefault; if (!d || d.documentation.trim()!==req.documentation.trim()) return; return {requested:normalizeRequest(req),resolved:{provider:d.provider.trim(),model:d.model.trim(),confidence:"host-default"},fallbackUsed:false}; }
  if ("model" in req && req.model !== undefined) { const found=ctx.availableModels.find(x=>x.provider.trim()===req.provider.trim()&&x.model.trim()===req.model.trim()); if (!found)return; return {requested:normalizeRequest(req),resolved:{provider:found.provider.trim(),model:found.model.trim(),confidence:"exact",...(req.alias?{alias:req.alias.trim()}: {})},fallbackUsed:false}; }
  const matches=ctx.availableModels.filter(x=>(!req.provider||x.provider.trim()===req.provider.trim())&&(x.aliases??[]).map(a=>a.trim()).includes(req.alias.trim())).sort((a,b)=>cmp(a.provider,b.provider)||cmp(a.model,b.model));
  if(matches.length===1) return {requested:normalizeRequest(req),resolved:{provider:matches[0].provider.trim(),model:matches[0].model.trim(),confidence:"alias",alias:req.alias.trim()},fallbackUsed:false};
  if(matches.length>1)return;
  const opaque=(ctx.opaqueAliases??[]).filter(x=>x.alias.trim()===req.alias.trim()&&(!req.provider||x.provider?.trim()===req.provider.trim()));
  if(opaque.length!==1)return;
  return {requested:normalizeRequest(req),resolved:{alias:req.alias.trim(),confidence:"unknown",executionIdentity:"host-opaque-alias",documentation:opaque[0].documentation.trim(),...(opaque[0].provider?{provider:opaque[0].provider.trim()}: {})},fallbackUsed:false};
}
function entryIdentity(requested: EvaluationModelRequest): string { return createHash("sha256").update(requestKey(requested)).digest("hex").slice(0,16); }
function resolvedKey(identity: EvaluationIdentityReceipt["resolved"]): string {
  return identity.confidence === "unknown" ? `opaque/${identity.provider ?? "host"}/${identity.alias}` : `${identity.provider}/${identity.model}`;
}
function idPart(value: string): string { return encodeURIComponent(value); }
export function resolveEvaluationJobs(value: unknown, context: EvaluationResolutionContext): EvaluationResolutionReceipt {
  const plan=normalizeEvaluationMatrixPlan(value); const available=context.availableModels;
  if(!Array.isArray(available)||available.length>10000||available.some(x=>!text(x.provider)||!text(x.model)||x.aliases?.some(a=>!text(a)))) throw new EvaluationPlanValidationError([diag("/resolution/availableModels","Available model inventory is malformed or excessive.","Provide at most 10,000 bounded concrete identities.")]);
  const opaque=context.opaqueAliases??[];
  if(!Array.isArray(opaque)||opaque.length>10000||opaque.some(x=>!text(x.alias)||!text(x.documentation)||(x.provider!==undefined&&!text(x.provider)))) throw new EvaluationPlanValidationError([diag("/resolution/opaqueAliases","Opaque alias inventory is malformed or excessive.","Provide bounded host-routable aliases with documentation.")]);
  const jobs: EvaluationResolutionReceipt["jobs"]=[]; const receipts: EvaluationIdentityReceipt[]=[]; let runIndex=0;
  for(const role of plan.modelMatrix.roles) for(let matrixEntryIndex=0;matrixEntryIndex<role.models.length;matrixEntryIndex++){ const requested=role.models[matrixEntryIndex]; let receipt=resolveOne(requested,context); if(!receipt){ for(let i=0;i<(role.fallback??[]).length;i++){ const r=resolveOne(role.fallback![i],context); if(r){receipt={...r,requested:normalizeRequest(requested),fallbackUsed:true,fallbackIndex:i};break;} } } if(!receipt) throw new EvaluationPlanValidationError([diag(`/modelMatrix/roles/${role.role}/models/${matrixEntryIndex}`,`No executable identity resolves ${requestKey(requested)} and its fallbacks.`,"Expose a concrete identity, declare one documented opaque host alias, or provide an available fallback.")]); receipts.push(receipt); const matrixEntryIdentity=entryIdentity(requested); for(const s of plan.scenarios)for(const c of plan.configurations)for(let repetition=1;repetition<=plan.modelMatrix.repetitions;repetition++){runIndex++; const resolved=resolvedKey(receipt.resolved); jobs.push({jobId:`job::run-${runIndex}::${idPart(s.id)}::${idPart(c.id)}::${role.role}::entry-${matrixEntryIndex}-${matrixEntryIdentity}::resolved-${idPart(resolved)}::repetition-${repetition}`,runIndex,matrixEntryIndex,matrixEntryIdentity,scenarioId:s.id,configurationId:c.id,role:role.role,repetition,budget:plan.modelMatrix.budgetPerRun,identity:receipt});} }
  jobs.sort((a,b)=>cmp(a.jobId,b.jobId)); if(jobs.length!==plan.computed.totalJobs||new Set(jobs.map(j=>j.jobId)).size!==jobs.length) throw new Error("resolved job identity invariant failed");
  return {schemaVersion:EVALUATION_MATRIX_PLAN_VERSION,planHash:hashEvaluationMatrixPlan(value),requestedIdentities:plan.modelMatrix.roles.flatMap(r=>r.models),resolvedIdentities:receipts,jobs,totalRuns:plan.computed.totalRuns,effectiveConcurrency:plan.computed.effectiveConcurrency};
}
