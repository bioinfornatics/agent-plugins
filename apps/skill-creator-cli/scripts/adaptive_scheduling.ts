import {
	closeSync,
	constants,
	existsSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import {
	anytimeQualityPolicyHash,
	canonicalJson,
	evaluateAnytimeQuality,
	persistAnytimeQualityResult,
	validateAnytimeQualityPolicy,
	type AnytimeLook,
	type AnytimeQualityPolicy,
	type PairedQualityObservation,
} from "./anytime_quality.js";
import { readTrustedJson } from "./trusted_snapshot.js";
import { assertPortableScenarioId } from "./scenario_id.js";
import { acquireDirectoryLock, durableAtomicWrite } from "./durable_file.js";

export const ADAPTIVE_SCHEDULER_STATE = ".adaptive-scheduling.json";
const MAX_STATE_BYTES = 16 * 1024 * 1024,
	COORDINATE_LIMIT = 4096;
export interface CountedPair {
	scenario_id: string;
	pair_index: number;
	candidate_run: string;
	baseline_run: string;
}
export interface AdaptiveSchedulingState {
	schema_version: "1.0";
	artifact: "adaptive-scheduling-state";
	policy_hash: string;
	policy: AnytimeQualityPolicy;
	admitted_rounds: number[];
	counted_pairs: CountedPair[];
	observations: PairedQualityObservation[];
	looks: AnytimeLook[];
	decision: "winner" | "regression" | "futility" | "continue" | "inconclusive";
	stop_reason: string | null;
	superseded_unstarted_tasks: string[];
	revision: number;
	state_hash: string;
}
interface EvaluationMetadataBoundary {
	eval_id: unknown;
}

interface GradingBoundary {
	summary?: { pass_rate?: unknown };
}

function boundaryObject<T extends object>(value: unknown, label: string): T {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new TypeError(label + " must be an object");
	return value as T;
}

export interface AdaptivePlanCell {
	scenario_id: string;
	pair_index: number;
	role: "candidate" | "baseline";
	coordinate_id: string;
	run_dir: string;
}
function exactObject(
	value: unknown,
	label: string,
	keys: string[],
): asserts value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(label + " must be an object");
	const a = Object.keys(value as object).sort(),
		b = [...keys].sort();
	if (a.length !== b.length || a.some((x, i) => x !== b[i]))
		throw new TypeError(label + " has an invalid shape");
}
function hash(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function payload(
	state: Omit<AdaptiveSchedulingState, "state_hash"> | AdaptiveSchedulingState,
): Omit<AdaptiveSchedulingState, "state_hash"> {
	const { state_hash: _ignored, ...rest } = state as AdaptiveSchedulingState;
	return rest;
}
function withHash(
	state: Omit<AdaptiveSchedulingState, "state_hash">,
): AdaptiveSchedulingState {
	return { ...state, state_hash: hash(state) };
}
function atomic(path: string, value: unknown): void {
	durableAtomicWrite(path, JSON.stringify(value, null, 2) + "\n");
}
function coordinate(workspace: string, runDir: string): string {
	const rel = relative(resolve(workspace), resolve(runDir)).replaceAll(
		"\\",
		"/",
	);
	if (
		!rel ||
		rel.length > COORDINATE_LIMIT ||
		isAbsolute(rel) ||
		rel.split("/").some((x) => !x || x === "." || x === "..")
	)
		throw new TypeError(
			"adaptive run coordinate must be a bounded contained identifier",
		);
	return rel;
}
export function adaptivePlanFromRuns(
	workspace: string,
	runDirs: string[],
): AdaptivePlanCell[] {
	const root = resolve(workspace),
		seen = new Set<string>();
	return runDirs
		.map((runDir) => {
			const id = coordinate(root, runDir),
				match =
					/^eval-(.+)\/(with_skill|old_skill|without_skill)\/run-([1-9]\d*)$/.exec(
						id,
					);
			if (!match)
				throw new TypeError("adaptive run coordinate is not canonical: " + id);
			const metadataPath = resolve(
				root,
				"eval-" + match[1],
				"eval_metadata.json",
			);
			const metadata = boundaryObject<EvaluationMetadataBoundary>(
				readTrustedJson(root, metadataPath, "adaptive eval_metadata.json"),
				"adaptive eval metadata",
			);
			const scenario_id = assertPortableScenarioId(metadata.eval_id);
			if (scenario_id !== match[1])
				throw new TypeError(
					"adaptive run coordinate does not match its scenario identity",
				);
			const pair_index = Number(match[3]);
			if (!Number.isSafeInteger(pair_index))
				throw new TypeError("adaptive pair coordinate is invalid");
			const role =
					match[2] === "with_skill"
						? ("candidate" as const)
						: ("baseline" as const),
				key = scenario_id + "\0" + pair_index + "\0" + role;
			if (seen.has(key))
				throw new TypeError("adaptive plan contains duplicate coordinates");
			seen.add(key);
			return {
				scenario_id,
				pair_index,
				role,
				coordinate_id: id,
				run_dir: resolve(runDir),
			};
		})
		.sort(
			(a, b) =>
				a.pair_index - b.pair_index ||
				a.scenario_id.localeCompare(b.scenario_id) ||
				a.role.localeCompare(b.role),
		);
}
export function defaultAdaptivePolicy(
	scenarios: Array<{ id: string; weight?: number }>,
	maxPairs: number,
): AnytimeQualityPolicy {
	const weight = 1 / scenarios.length;
	return validateAnytimeQualityPolicy({
		schema_version: "2.0",
		method: "finite-horizon-fixed-weight-hoeffding-cs-v2",
		estimand: "fixed-weight-mean-paired-quality-effect",
		assumptions: {
			round_data_generating_process: "stable-independent-rounds",
			completion_missingness: "all-admitted-rounds-complete-no-skip",
			retry_target: "terminal-attempt-policy",
			informative_missingness_scope: "no-source-population-generalization",
		},
		comparison_family: {
			family_id: "default",
			global_alpha: 0.05,
			planned_comparisons: 1,
			comparison_ids: ["candidate-vs-baseline"],
			allocation_weights: [1],
			comparison_id: "candidate-vs-baseline",
			comparison_index: 1,
		},
		min_pairs: Math.min(3, maxPairs),
		max_pairs: maxPairs,
		alpha: 0.05,
		quality_bounds: { min: 0, max: 1 },
		practical_superiority_delta: 0,
		regression_tolerance: 0,
		multiplicity: { winner_fraction: 0.5, regression_fraction: 0.5 },
		scenarios: scenarios.map((item) => ({
			id: item.id,
			weight: item.weight ?? weight,
		})),
		futility: {
			enabled: false,
			minimum_pairs: Math.min(3, maxPairs),
			equivalence_lower: 0,
			equivalence_upper: 0,
			at_max: "futility-if-contained",
		},
	});
}
export function resolveAdaptivePolicy(
	input: unknown,
	scenarioIds: string[],
	fallbackMax: number,
): AnytimeQualityPolicy {
	const policy =
		input === undefined
			? defaultAdaptivePolicy(
					scenarioIds.map((id) => ({ id })),
					fallbackMax,
				)
			: validateAnytimeQualityPolicy(input);
	const wanted = [...scenarioIds].sort(),
		actual = policy.scenarios.map((x) => x.id).sort();
	if (JSON.stringify(actual) !== JSON.stringify(wanted))
		throw new TypeError(
			"adaptive policy scenarios must exactly match evaluation scenario ids",
		);
	return policy;
}
export function newAdaptiveState(
	policyInput: AnytimeQualityPolicy,
): AdaptiveSchedulingState {
	const policy = validateAnytimeQualityPolicy(policyInput);
	return withHash({
		schema_version: "1.0",
		artifact: "adaptive-scheduling-state",
		policy_hash: anytimeQualityPolicyHash(policy),
		policy,
		admitted_rounds: [],
		counted_pairs: [],
		observations: [],
		looks: [],
		decision: "continue",
		stop_reason: null,
		superseded_unstarted_tasks: [],
		revision: 0,
	});
}
function readBounded(path: string): unknown {
	let fd: number | undefined;
	try {
		const named = lstatSync(path);
		if (named.isSymbolicLink() || !named.isFile())
			throw new TypeError(
				"adaptive scheduling state must be a regular non-symlink file",
			);
		fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const before = fstatSync(fd);
		if (
			before.dev !== named.dev ||
			before.ino !== named.ino ||
			before.size <= 0 ||
			before.size > MAX_STATE_BYTES
		)
			throw new TypeError(
				"adaptive scheduling state is not a bounded stable file",
			);
		const text = readFileSync(fd, "utf8"),
			after = fstatSync(fd);
		if (
			after.ino !== before.ino ||
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs ||
			Buffer.byteLength(text) !== before.size
		)
			throw new Error("adaptive scheduling state changed while being read");
		try {
			return JSON.parse(text);
		} catch {
			throw new TypeError("adaptive scheduling state is not valid JSON");
		}
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
function planMaps(plan: AdaptivePlanCell[], policy: AnytimeQualityPolicy) {
	const keys = new Map<string, AdaptivePlanCell>();
	for (const cell of plan) {
		if (
			!policy.scenarios.some((x) => x.id === cell.scenario_id) ||
			cell.pair_index < 1 ||
			cell.pair_index > policy.max_pairs
		)
			throw new TypeError("adaptive plan coordinate is outside the policy");
		keys.set(
			cell.scenario_id + "\0" + cell.pair_index + "\0" + cell.role,
			cell,
		);
	}
	for (let round = 1; round <= policy.max_pairs; round++)
		for (const scenario of policy.scenarios)
			for (const role of ["candidate", "baseline"] as const)
				if (!keys.has(scenario.id + "\0" + round + "\0" + role))
					throw new TypeError(
						"adaptive plan does not contain every predeclared coordinate",
					);
	return keys;
}
function hasStartedEvidence(cell: AdaptivePlanCell): boolean {
	const generated = [
		"execution-evidence.json",
		"grading.json",
		"timing.json",
		"execution-outcome.json",
		"transcript.json",
		"events.json",
		"navigation.json",
		"deterministic-evidence.json",
		"grader-evidence",
		"run-identity.json",
	];
	if (generated.some((name) => existsSync(resolve(cell.run_dir, name))))
		return true;
	const outputs = resolve(cell.run_dir, "outputs");
	try {
		return (
			lstatSync(outputs).isDirectory() &&
			readdirSync(outputs).some((name) => name !== ".keep")
		);
	} catch {
		return false;
	}
}
interface AdaptiveStateBoundary extends Record<string, unknown> {
	policy: unknown;
	policy_hash: unknown;
	admitted_rounds: unknown;
	observations: unknown;
	schema_version: unknown;
	artifact: unknown;
	state_hash: unknown;
}

/**
 * Scheduling invariant: admitted rounds form a contiguous prefix, only complete
 * paired evidence is counted, and no started coordinate is marked superseded.
 */
function canonicalFrom(
	raw: AdaptiveStateBoundary,
	policyInput: AnytimeQualityPolicy,
	plan: AdaptivePlanCell[],
): AdaptiveSchedulingState {
	const policy = validateAnytimeQualityPolicy(policyInput),
		maps = planMaps(plan, policy);
	if (
		canonicalJson(raw.policy) !== canonicalJson(policy) ||
		raw.policy_hash !== anytimeQualityPolicyHash(policy)
	)
		throw new Error(
			"adaptive scheduling state does not match the verified predeclared policy",
		);
	if (!Array.isArray(raw.admitted_rounds) || !Array.isArray(raw.observations))
		throw new TypeError(
			"adaptive scheduling rounds and observations must be arrays",
		);
	const admitted = raw.admitted_rounds.map((x: unknown, i: number) => {
		if (
			!Number.isSafeInteger(x) ||
			Number(x) !== i + 1 ||
			Number(x) > policy.max_pairs
		)
			throw new Error(
				"adaptive admitted rounds must be a bounded contiguous prefix",
			);
		return Number(x);
	});
	const evaluated = evaluateAnytimeQuality(policy, raw.observations),
		complete = evaluated.complete_pairs;
	if (
		admitted.length < complete ||
		admitted.length > complete + (evaluated.terminal ? 0 : 1)
	)
		throw new Error(
			"adaptive admitted rounds do not match the validated decision trace",
		);
	const observations = (raw.observations as PairedQualityObservation[])
		.slice()
		.sort(
			(a, b) =>
				a.pair_index - b.pair_index ||
				a.scenario_id.localeCompare(b.scenario_id),
		);
	if (observations.length !== complete * policy.scenarios.length)
		throw new Error("adaptive state may count only complete contiguous pairs");
	const counted: CountedPair[] = observations.map((o) => {
		const candidate = maps.get(
				o.scenario_id + "\0" + o.pair_index + "\0candidate",
			)!,
			baseline = maps.get(o.scenario_id + "\0" + o.pair_index + "\0baseline")!;
		for (const cell of [candidate, baseline]) {
			if (
				!existsSync(cell.run_dir + "/execution-evidence.json") ||
				!existsSync(cell.run_dir + "/grading.json")
			)
				throw new Error(
					"adaptive counted pair lacks validated execution evidence: " +
						cell.coordinate_id,
				);
		}
		const a = boundaryObject<GradingBoundary>(
				readTrustedJson(
					resolve(candidate.run_dir, "../../.."),
					candidate.run_dir + "/grading.json",
					"adaptive candidate grading.json",
				),
				"adaptive candidate grading",
			),
			b = boundaryObject<GradingBoundary>(
				readTrustedJson(
					resolve(baseline.run_dir, "../../.."),
					baseline.run_dir + "/grading.json",
					"adaptive baseline grading.json",
				),
				"adaptive baseline grading",
			);
		if (
			Number(a?.summary?.pass_rate) !== o.candidate ||
			Number(b?.summary?.pass_rate) !== o.baseline
		)
			throw new Error(
				"adaptive observation does not match validated run evidence",
			);
		return {
			scenario_id: o.scenario_id,
			pair_index: o.pair_index,
			candidate_run: candidate.coordinate_id,
			baseline_run: baseline.coordinate_id,
		};
	});
	const stop = evaluated.terminal ? evaluated.decision : null;
	const startedPairs = new Set(
		plan
			.filter(hasStartedEvidence)
			.map((x) => x.scenario_id + "\0" + x.pair_index),
	);
	const superseded = stop
		? plan
				.filter(
					(x) =>
						x.pair_index > complete &&
						!startedPairs.has(x.scenario_id + "\0" + x.pair_index),
				)
				.map((x) => x.coordinate_id)
				.sort()
		: [];
	const revision = admitted.length + complete;
	return withHash({
		schema_version: "1.0",
		artifact: "adaptive-scheduling-state",
		policy_hash: anytimeQualityPolicyHash(policy),
		policy,
		admitted_rounds: admitted,
		counted_pairs: counted,
		observations,
		looks: evaluated.looks,
		decision: evaluated.decision,
		stop_reason: stop,
		superseded_unstarted_tasks: superseded,
		revision,
	});
}
export function readAdaptiveState(
	path: string,
	policy: AnytimeQualityPolicy,
	workspace?: string,
	runDirs?: string[],
): AdaptiveSchedulingState {
	if (!existsSync(path)) return newAdaptiveState(policy);
	if (!workspace || !runDirs)
		throw new TypeError(
			"adaptive state verification requires the complete bounded execution plan",
		);
	const parsed = readBounded(path);
	exactObject(parsed, "adaptive scheduling state", [
		"schema_version",
		"artifact",
		"policy_hash",
		"policy",
		"admitted_rounds",
		"counted_pairs",
		"observations",
		"looks",
		"decision",
		"stop_reason",
		"superseded_unstarted_tasks",
		"revision",
		"state_hash",
	]);
	const raw = parsed as AdaptiveStateBoundary;
	if (
		raw.schema_version !== "1.0" ||
		raw.artifact !== "adaptive-scheduling-state"
	)
		throw new TypeError("unsupported adaptive scheduling state");
	if (
		typeof raw.state_hash !== "string" ||
		!/^[a-f0-9]{64}$/.test(raw.state_hash) ||
		raw.state_hash !== hash(payload(raw as unknown as AdaptiveSchedulingState))
	)
		throw new Error("adaptive scheduling state hash mismatch");
	const expected = canonicalFrom(
		raw,
		policy,
		adaptivePlanFromRuns(workspace, runDirs),
	);
	if (canonicalJson(raw) !== canonicalJson(expected))
		throw new Error("adaptive scheduling state is noncanonical or tampered");
	return expected;
}
export function persistAdaptiveState(
	path: string,
	state: AdaptiveSchedulingState,
): void {
	const next = withHash({
		...payload(state),
		revision: state.admitted_rounds.length + state.looks.length,
	});
	Object.assign(state, next);
	atomic(path, next);
}
export function recordAdaptiveLook(
	state: AdaptiveSchedulingState,
	pairs: CountedPair[],
	observations: PairedQualityObservation[],
	workspace: string,
): void {
	const known = new Set(
		state.counted_pairs.map((x) => x.scenario_id + "\0" + x.pair_index),
	);
	for (let i = 0; i < pairs.length; i++) {
		const key = pairs[i].scenario_id + "\0" + pairs[i].pair_index;
		if (known.has(key)) continue;
		known.add(key);
		state.counted_pairs.push(pairs[i]);
		state.observations.push(observations[i]);
	}
	state.counted_pairs.sort(
		(a, b) =>
			a.pair_index - b.pair_index || a.scenario_id.localeCompare(b.scenario_id),
	);
	state.observations.sort(
		(a, b) =>
			a.pair_index - b.pair_index || a.scenario_id.localeCompare(b.scenario_id),
	);
	const result = evaluateAnytimeQuality(state.policy, state.observations);
	state.looks = result.looks;
	state.decision = result.decision;
	state.stop_reason = result.terminal ? result.decision : null;
}
export function deriveSuperseded(
	state: AdaptiveSchedulingState,
	plan: AdaptivePlanCell[],
): void {
	const startedPairs = new Set(
		plan
			.filter(hasStartedEvidence)
			.map((x) => x.scenario_id + "\0" + x.pair_index),
	);
	state.superseded_unstarted_tasks = state.stop_reason
		? plan
				.filter(
					(x) =>
						x.pair_index > state.looks.length &&
						!startedPairs.has(x.scenario_id + "\0" + x.pair_index),
				)
				.map((x) => x.coordinate_id)
				.sort()
		: [];
}
export async function acquireAdaptiveLock(
	workspace: string,
): Promise<() => void> {
	return acquireDirectoryLock(resolve(workspace, ".adaptive-scheduling.lock"), {
		timeoutMs: 15_000,
		staleMs: 300_000,
	});
}
