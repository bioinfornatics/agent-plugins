import { createHash } from "node:crypto";
import { assertPortableScenarioId } from "./scenario_id.js";
import {
	acquireDirectoryLockSync,
	durableAtomicWrite,
} from "./durable_file.js";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

/**
 * Finite-horizon confidence sequence for bounded paired quality differences.
 * One look is one complete round across all fixed-weight scenarios. If quality
 * is in [a,b], each weighted round is in [-(b-a),b-a]. At look t each side gets
 * alpha_side,t = alpha * side_fraction * ((M+1)/M) / (t(t+1)). These finite
 * allocations sum to alpha*side_fraction. Hoeffding plus a union bound gives
 * simultaneous coverage over every predeclared look and hence optional-stopping
 * validity. The estimand is the predeclared fixed-weight mean paired quality effect under a
 * stable round data-generating process with independent rounds. Dependence within
 * a round is allowed. Every admitted round must complete: failed or incomplete
 * rounds block inference and may never be skipped. Claims do not generalize to a
 * source population under informative missingness. All values are predeclared.
 *
 * SHA-256 values in this artifact are deterministic integrity bindings only.
 * They detect corruption or inconsistency when the whole artifact is verified;
 * they do not prove external authenticity. Authenticity requires a trusted
 * signature, MAC, or independently trusted digest/distribution channel.
 */
export const ANYTIME_QUALITY_POLICY_VERSION = "2.0" as const;
export const ANYTIME_QUALITY_METHOD =
	"finite-horizon-fixed-weight-hoeffding-cs-v2" as const;
export const ANYTIME_QUALITY_ARTIFACT_VERSION = "2.0" as const;
export const ANYTIME_QUALITY_ARTIFACT_FILE = [
	"anytime-quality-decision",
	"json",
].join(".");
export const ANYTIME_QUALITY_CAPS = Object.freeze({
	max_artifact_bytes: 16 * 1024 * 1024,
	max_canonical_bytes_per_observation: 16_384,
	max_pairs: 1_024,
	max_scenarios: 1_024,
	max_observations: Math.floor((16 * 1024 * 1024) / 16_384),
	max_absolute_quality: 1_000_000_000_000,
	max_quality_range: 1_000_000_000_000,
	min_alpha: 1e-12,
	max_scenario_id_length: 128,
});
const INTEGRITY_NOTICE =
	"SHA-256 binds canonical artifact content for integrity; it does not establish external authenticity." as const;
export type AnytimeDecision =
	| "winner"
	| "regression"
	| "futility"
	| "continue"
	| "inconclusive";
export interface AnytimeQualityAssumptions {
	round_data_generating_process: "stable-independent-rounds";
	completion_missingness: "all-admitted-rounds-complete-no-skip";
	retry_target: "terminal-attempt-policy";
	informative_missingness_scope: "no-source-population-generalization";
}

export interface ComparisonFamilyPolicy {
	family_id: string;
	global_alpha: number;
	planned_comparisons: number;
	comparison_ids: string[];
	allocation_weights: number[];
	comparison_id: string;
	comparison_index: number;
}

export interface AnytimeQualityPolicy {
	schema_version: typeof ANYTIME_QUALITY_POLICY_VERSION;
	method: typeof ANYTIME_QUALITY_METHOD;
	estimand: "fixed-weight-mean-paired-quality-effect";
	assumptions: AnytimeQualityAssumptions;
	comparison_family: ComparisonFamilyPolicy;
	min_pairs: number;
	max_pairs: number;
	alpha: number;
	quality_bounds: { min: number; max: number };
	practical_superiority_delta: number;
	regression_tolerance: number;
	multiplicity: { winner_fraction: number; regression_fraction: number };
	scenarios: Array<{ id: string; weight: number }>;
	futility: {
		enabled: boolean;
		minimum_pairs: number;
		equivalence_lower: number;
		equivalence_upper: number;
		at_max: "futility-if-contained" | "inconclusive";
	};
}
export interface PairedQualityObservation {
	scenario_id: string;
	pair_index: number;
	candidate: number;
	baseline: number;
}
export interface AnytimeLook {
	look: number;
	scenario_differences: Array<{
		scenario_id: string;
		weight: number;
		difference: number;
	}>;
	weighted_difference: number;
	mean_difference: number;
	confidence_sequence: { lower: number; upper: number; confidence: number };
	alpha_allocation: { winner: number; regression: number };
	boundaries: {
		winner: number;
		regression: number;
		futility_lower: number | null;
		futility_upper: number | null;
	};
	decision: AnytimeDecision;
}
export interface AnytimeQualityResult {
	schema_version: "2.0";
	method: typeof ANYTIME_QUALITY_METHOD;
	policy: AnytimeQualityPolicy;
	policy_hash: string;
	observation_set_sha256: string;
	complete_pairs: number;
	pending_observations: number;
	decision: AnytimeDecision;
	terminal: boolean;
	looks: AnytimeLook[];
}
export interface AnytimeQualityArtifact {
	schema_version: typeof ANYTIME_QUALITY_ARTIFACT_VERSION;
	artifact: "anytime-quality-decision";
	integrity_notice: typeof INTEGRITY_NOTICE;
	policy: AnytimeQualityPolicy;
	observations: PairedQualityObservation[];
	result: AnytimeQualityResult;
	artifact_sha256: string;
}
function finite(value: unknown, label: string): asserts value is number {
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new TypeError(label + " must be a finite number");
}
function safeInteger(
	value: unknown,
	label: string,
	minimum: number,
	maximum: number,
): asserts value is number {
	finite(value, label);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
		throw new TypeError(
			label + " must be a safe integer between " + minimum + " and " + maximum,
		);
}
function finiteArithmetic(value: number, label: string): number {
	if (!Number.isFinite(value))
		throw new TypeError(label + " must remain finite");
	return value;
}
/**
 * Validation invariant: every persisted policy/artifact object has exactly its
 * declared keys. Validation reconstructs a fresh canonical value, so unknown
 * fields can neither affect decisions nor disappear silently during hashing.
 */
function exactObject(
	value: unknown,
	label: string,
	keys: string[],
): asserts value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(label + " must be an object");
	const actual = Object.keys(value as object).sort(),
		expected = [...keys].sort();
	if (
		actual.length !== expected.length ||
		actual.some((key, index) => key !== expected[index])
	)
		throw new TypeError(label + " has an invalid shape");
}
function canonicalValue(value: unknown): unknown {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number") {
		finite(value, "canonical number");
		return Object.is(value, -0) ? 0 : value;
	}
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (typeof value === "object")
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => {
					if (item === undefined)
						throw new TypeError("canonical values cannot contain undefined");
					return [key, canonicalValue(item)];
				}),
		);
	throw new TypeError("canonical values must contain only JSON values");
}
export function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalValue(value));
}
function digest(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function validateAnytimeQualityPolicy(
	input: unknown,
): AnytimeQualityPolicy {
	exactObject(input, "policy", [
		"schema_version",
		"method",
		"estimand",
		"assumptions",
		"comparison_family",
		"min_pairs",
		"max_pairs",
		"alpha",
		"quality_bounds",
		"practical_superiority_delta",
		"regression_tolerance",
		"multiplicity",
		"scenarios",
		"futility",
	]);
	const p = input as Record<string, unknown> & {
		assumptions: Record<string, unknown>;
		comparison_family: Record<string, unknown>;
		quality_bounds: Record<string, unknown>;
		multiplicity: Record<string, unknown>;
		scenarios: Array<Record<string, unknown>>;
		futility: Record<string, unknown>;
	};
	if (p.schema_version !== ANYTIME_QUALITY_POLICY_VERSION)
		throw new TypeError("unsupported policy schema_version");
	if (p.method !== ANYTIME_QUALITY_METHOD)
		throw new TypeError("unsupported policy method");
	if (p.estimand !== "fixed-weight-mean-paired-quality-effect")
		throw new TypeError(
			"adaptive estimand must be the predeclared fixed-weight mean paired quality effect",
		);
	exactObject(p.assumptions, "assumptions", [
		"round_data_generating_process",
		"completion_missingness",
		"retry_target",
		"informative_missingness_scope",
	]);
	if (
		p.assumptions.round_data_generating_process !==
			"stable-independent-rounds" ||
		p.assumptions.completion_missingness !==
			"all-admitted-rounds-complete-no-skip" ||
		p.assumptions.retry_target !== "terminal-attempt-policy" ||
		p.assumptions.informative_missingness_scope !==
			"no-source-population-generalization"
	)
		throw new TypeError(
			"adaptive statistical assumptions must be explicitly predeclared",
		);
	exactObject(p.comparison_family, "comparison_family", [
		"family_id",
		"global_alpha",
		"planned_comparisons",
		"comparison_ids",
		"allocation_weights",
		"comparison_id",
		"comparison_index",
	]);
	if (
		typeof p.comparison_family.family_id !== "string" ||
		!/^[-A-Za-z0-9_.:]{1,128}$/.test(p.comparison_family.family_id) ||
		typeof p.comparison_family.comparison_id !== "string" ||
		!/^[-A-Za-z0-9_.:]{1,128}$/.test(p.comparison_family.comparison_id)
	)
		throw new TypeError(
			"comparison family and comparison ids must be portable identifiers",
		);
	finite(p.comparison_family.global_alpha, "comparison_family.global_alpha");
	if (
		!(
			p.comparison_family.global_alpha >= ANYTIME_QUALITY_CAPS.min_alpha &&
			p.comparison_family.global_alpha < 1
		)
	)
		throw new TypeError(
			"comparison family global_alpha is outside the explicit caps",
		);
	safeInteger(
		p.comparison_family.planned_comparisons,
		"comparison_family.planned_comparisons",
		1,
		ANYTIME_QUALITY_CAPS.max_pairs,
	);
	safeInteger(
		p.comparison_family.comparison_index,
		"comparison_family.comparison_index",
		1,
		p.comparison_family.planned_comparisons,
	);
	if (
		!Array.isArray(p.comparison_family.comparison_ids) ||
		p.comparison_family.comparison_ids.length !==
			p.comparison_family.planned_comparisons ||
		new Set(p.comparison_family.comparison_ids).size !==
			p.comparison_family.planned_comparisons ||
		p.comparison_family.comparison_ids.some(
			(id: unknown) =>
				typeof id !== "string" || !/^[-A-Za-z0-9_.:]{1,128}$/.test(id),
		)
	)
		throw new TypeError(
			"comparison family comparison_ids must uniquely name every planned comparison",
		);
	if (
		p.comparison_family.comparison_ids[
			p.comparison_family.comparison_index - 1
		] !== p.comparison_family.comparison_id
	)
		throw new TypeError(
			"comparison_id must match its planned comparison index",
		);
	if (
		!Array.isArray(p.comparison_family.allocation_weights) ||
		p.comparison_family.allocation_weights.length !==
			p.comparison_family.planned_comparisons
	)
		throw new TypeError(
			"comparison family allocation_weights must cover every planned comparison",
		);
	let familyWeightSum = 0;
	for (const [
		index,
		weight,
	] of p.comparison_family.allocation_weights.entries()) {
		finite(weight, "comparison family allocation weight " + index);
		if (!(weight > 0))
			throw new TypeError(
				"comparison family allocation weights must be positive",
			);
		familyWeightSum = finiteArithmetic(
			familyWeightSum + weight,
			"comparison family allocation sum",
		);
	}
	const allocatedFamilyAlpha = finiteArithmetic(
		(p.comparison_family.global_alpha *
			p.comparison_family.allocation_weights[
				p.comparison_family.comparison_index - 1
			]) /
			familyWeightSum,
		"allocated family alpha",
	);
	safeInteger(p.min_pairs, "min_pairs", 1, ANYTIME_QUALITY_CAPS.max_pairs);
	safeInteger(p.max_pairs, "max_pairs", 1, ANYTIME_QUALITY_CAPS.max_pairs);
	if (p.min_pairs > p.max_pairs)
		throw new TypeError("min_pairs must not exceed max_pairs");
	finite(p.alpha, "alpha");
	if (!(p.alpha >= ANYTIME_QUALITY_CAPS.min_alpha && p.alpha < 1))
		throw new TypeError("alpha is outside the explicit policy caps");
	if (
		p.alpha >
		allocatedFamilyAlpha + Number.EPSILON * Math.max(1, allocatedFamilyAlpha)
	)
		throw new TypeError(
			"campaign alpha exceeds its allocated comparison-family alpha",
		);
	exactObject(p.quality_bounds, "quality_bounds", ["min", "max"]);
	finite(p.quality_bounds.min, "quality_bounds.min");
	finite(p.quality_bounds.max, "quality_bounds.max");
	if (
		Math.abs(p.quality_bounds.min) >
			ANYTIME_QUALITY_CAPS.max_absolute_quality ||
		Math.abs(p.quality_bounds.max) > ANYTIME_QUALITY_CAPS.max_absolute_quality
	)
		throw new TypeError("quality_bounds exceed the explicit magnitude cap");
	if (!(p.quality_bounds.min < p.quality_bounds.max))
		throw new TypeError("quality_bounds.min must be below quality_bounds.max");
	const range = finiteArithmetic(
		p.quality_bounds.max - p.quality_bounds.min,
		"quality range",
	);
	if (range > ANYTIME_QUALITY_CAPS.max_quality_range)
		throw new TypeError("quality range exceeds the explicit cap");
	finiteArithmetic(2 * range, "difference width");
	finite(p.practical_superiority_delta, "practical_superiority_delta");
	if (
		p.practical_superiority_delta < 0 ||
		p.practical_superiority_delta > range
	)
		throw new TypeError(
			"practical_superiority_delta is outside the bounded difference range",
		);
	finite(p.regression_tolerance, "regression_tolerance");
	if (p.regression_tolerance < 0 || p.regression_tolerance > range)
		throw new TypeError(
			"regression_tolerance is outside the bounded difference range",
		);
	exactObject(p.multiplicity, "multiplicity", [
		"winner_fraction",
		"regression_fraction",
	]);
	finite(p.multiplicity.winner_fraction, "multiplicity.winner_fraction");
	finite(
		p.multiplicity.regression_fraction,
		"multiplicity.regression_fraction",
	);
	const fractionSum = finiteArithmetic(
		p.multiplicity.winner_fraction + p.multiplicity.regression_fraction,
		"multiplicity fraction sum",
	);
	if (
		!(
			p.multiplicity.winner_fraction > 0 &&
			p.multiplicity.regression_fraction > 0 &&
			fractionSum <= 1
		)
	)
		throw new TypeError(
			"multiplicity fractions must be positive and sum to at most 1",
		);
	if (
		!Array.isArray(p.scenarios) ||
		!p.scenarios.length ||
		p.scenarios.length > ANYTIME_QUALITY_CAPS.max_scenarios
	)
		throw new TypeError("scenarios must be a non-empty bounded array");
	if (p.scenarios.length * p.max_pairs > ANYTIME_QUALITY_CAPS.max_observations)
		throw new TypeError(
			"scenario and pair product exceeds the observation cap",
		);
	const ids = new Set<string>();
	let totalWeight = 0;
	for (const [index, s] of p.scenarios.entries()) {
		exactObject(s, "scenario " + index, ["id", "weight"]);
		const scenarioId = assertPortableScenarioId(s.id);
		s.id = scenarioId;
		if (ids.has(scenarioId))
			throw new TypeError("duplicate scenario id: " + s.id);
		ids.add(scenarioId);
		finite(s.weight, "scenario weight");
		if (!(s.weight > 0 && s.weight <= 1))
			throw new TypeError("scenario weights must be in (0,1]");
		totalWeight = finiteArithmetic(
			totalWeight + s.weight,
			"scenario weight sum",
		);
	}
	if (Math.abs(totalWeight - 1) > 1e-12)
		throw new TypeError("scenario weights must sum to 1");
	const sortedScenarios = p.scenarios
		.map((s) => ({ id: s.id as string, weight: s.weight as number }))
		.sort((a, b) => a.id.localeCompare(b.id));
	let normalizedPrefix = 0;
	const normalizedScenarios = sortedScenarios.map((s, index: number) => {
		const weight =
			index === sortedScenarios.length - 1
				? finiteArithmetic(
						1 - normalizedPrefix,
						"final normalized scenario weight",
					)
				: finiteArithmetic(
						s.weight / totalWeight,
						"normalized scenario weight",
					);
		if (!(weight > 0 && weight <= 1))
			throw new TypeError("normalized scenario weights must be in (0,1]");
		normalizedPrefix = finiteArithmetic(
			normalizedPrefix + weight,
			"normalized scenario weight sum",
		);
		return { id: s.id, weight };
	});
	if (normalizedPrefix !== 1)
		throw new TypeError(
			"normalized scenario weights must have exact operational sum 1",
		);
	exactObject(p.futility, "futility", [
		"enabled",
		"minimum_pairs",
		"equivalence_lower",
		"equivalence_upper",
		"at_max",
	]);
	if (typeof p.futility.enabled !== "boolean")
		throw new TypeError("futility.enabled must be boolean");
	if (
		p.futility.at_max !== "futility-if-contained" &&
		p.futility.at_max !== "inconclusive"
	)
		throw new TypeError("futility.at_max must declare maximum-look semantics");
	safeInteger(
		p.futility.minimum_pairs,
		"futility.minimum_pairs",
		1,
		ANYTIME_QUALITY_CAPS.max_pairs,
	);
	finite(p.futility.equivalence_lower, "futility.equivalence_lower");
	finite(p.futility.equivalence_upper, "futility.equivalence_upper");
	if (
		p.futility.enabled &&
		(p.futility.minimum_pairs < p.min_pairs ||
			p.futility.minimum_pairs > p.max_pairs)
	)
		throw new TypeError(
			"enabled futility.minimum_pairs must be >= min_pairs and < max_pairs",
		);
	if (
		p.futility.enabled &&
		!(
			-p.regression_tolerance < p.futility.equivalence_lower &&
			p.futility.equivalence_lower <= p.futility.equivalence_upper &&
			p.futility.equivalence_upper < p.practical_superiority_delta
		)
	)
		throw new TypeError(
			"enabled futility interval must lie strictly inside decision boundaries",
		);
	return {
		schema_version: p.schema_version,
		method: p.method,
		estimand: p.estimand,
		assumptions: {
			round_data_generating_process:
				p.assumptions.round_data_generating_process,
			completion_missingness: p.assumptions.completion_missingness,
			retry_target: p.assumptions.retry_target,
			informative_missingness_scope:
				p.assumptions.informative_missingness_scope,
		},
		comparison_family: {
			family_id: p.comparison_family.family_id,
			global_alpha: p.comparison_family.global_alpha,
			planned_comparisons: p.comparison_family.planned_comparisons,
			comparison_ids: [...p.comparison_family.comparison_ids],
			allocation_weights: [...p.comparison_family.allocation_weights],
			comparison_id: p.comparison_family.comparison_id,
			comparison_index: p.comparison_family.comparison_index,
		},
		min_pairs: p.min_pairs,
		max_pairs: p.max_pairs,
		alpha: p.alpha,
		quality_bounds: { min: p.quality_bounds.min, max: p.quality_bounds.max },
		practical_superiority_delta: p.practical_superiority_delta,
		regression_tolerance: p.regression_tolerance,
		multiplicity: {
			winner_fraction: p.multiplicity.winner_fraction,
			regression_fraction: p.multiplicity.regression_fraction,
		},
		scenarios: normalizedScenarios,
		futility: {
			enabled: p.futility.enabled,
			minimum_pairs: p.futility.minimum_pairs,
			equivalence_lower: p.futility.equivalence_lower,
			equivalence_upper: p.futility.equivalence_upper,
			at_max: p.futility.at_max,
		},
	};
}
export function anytimeQualityPolicyHash(policy: unknown): string {
	return digest(validateAnytimeQualityPolicy(policy));
}
function validateObservations(
	input: unknown,
	policy: AnytimeQualityPolicy,
): PairedQualityObservation[] {
	if (
		!Array.isArray(input) ||
		input.length > ANYTIME_QUALITY_CAPS.max_observations
	)
		throw new TypeError("observations must be a bounded array");
	const scenarios = new Set(policy.scenarios.map((s) => s.id)),
		seen = new Set<string>();
	return input
		.map((raw, index) => {
			exactObject(raw, "observation " + index, [
				"scenario_id",
				"pair_index",
				"candidate",
				"baseline",
			]);
			const o = raw as Record<string, unknown>;
			if (typeof o.scenario_id !== "string" || !scenarios.has(o.scenario_id))
				throw new TypeError("observation has unknown scenario_id");
			safeInteger(o.pair_index, "observation pair_index", 1, policy.max_pairs);
			finite(o.candidate, "observation candidate");
			finite(o.baseline, "observation baseline");
			if (
				o.candidate < policy.quality_bounds.min ||
				o.candidate > policy.quality_bounds.max ||
				o.baseline < policy.quality_bounds.min ||
				o.baseline > policy.quality_bounds.max
			)
				throw new TypeError("observation quality is outside quality_bounds");
			const difference = finiteArithmetic(
				o.candidate - o.baseline,
				"observation difference",
			);
			if (
				Math.abs(difference) >
				policy.quality_bounds.max - policy.quality_bounds.min
			)
				throw new TypeError("observation difference exceeds quality range");
			const key = o.scenario_id + "\u0000" + o.pair_index;
			if (seen.has(key))
				throw new TypeError(
					"duplicate observation for scenario and pair_index",
				);
			seen.add(key);
			return {
				scenario_id: o.scenario_id,
				pair_index: o.pair_index,
				candidate: o.candidate,
				baseline: o.baseline,
			};
		})
		.sort(
			(a, b) =>
				a.pair_index - b.pair_index ||
				a.scenario_id.localeCompare(b.scenario_id),
		);
}
export function evaluateAnytimeQuality(
	policyInput: unknown,
	observationInput: unknown,
): AnytimeQualityResult {
	const policy = validateAnytimeQualityPolicy(policyInput),
		observations = validateObservations(observationInput, policy),
		byKey = new Map(
			observations.map((o) => [o.pair_index + "\u0000" + o.scenario_id, o]),
		);
	let complete = 0;
	for (let pair = 1; pair <= policy.max_pairs; pair++) {
		if (policy.scenarios.every((s) => byKey.has(pair + "\u0000" + s.id)))
			complete = pair;
		else break;
	}
	const range = finiteArithmetic(
			policy.quality_bounds.max - policy.quality_bounds.min,
			"quality range",
		),
		differenceWidth = finiteArithmetic(2 * range, "difference width"),
		looks: AnytimeLook[] = [];
	let sum = 0,
		decision: AnytimeDecision = "continue";
	for (let look = 1; look <= complete; look++) {
		const rows = policy.scenarios.map((s) => {
			const o = byKey.get(look + "\u0000" + s.id)!;
			return {
				scenario_id: s.id,
				weight: s.weight,
				difference: finiteArithmetic(
					o.candidate - o.baseline,
					"scenario difference",
				),
			};
		});
		const rawValue = rows.reduce(
			(total, row) =>
				finiteArithmetic(
					total +
						finiteArithmetic(row.weight * row.difference, "weighted term"),
					"weighted difference",
				),
			0,
		);
		// Canonical weights are positive and sum to exactly one in this order,
		// making the real-valued result a convex combination in [-range, range].
		// IEEE-754 rounding can cross an endpoint; clamping restores that support.
		const value = finiteArithmetic(
			Math.max(-range, Math.min(range, rawValue)),
			"bounded weighted difference",
		);
		if (value < -range || value > range)
			throw new TypeError("weighted difference escaped its proven support");
		sum = finiteArithmetic(sum + value, "cumulative weighted difference");
		const mean = finiteArithmetic(sum / look, "mean difference"),
			lookDenominator = finiteArithmetic(look * (look + 1), "look denominator"),
			lookFraction = finiteArithmetic(
				finiteArithmetic(
					(policy.max_pairs + 1) / policy.max_pairs,
					"horizon normalization",
				) / lookDenominator,
				"look allocation",
			),
			winnerAlpha = finiteArithmetic(
				policy.alpha * policy.multiplicity.winner_fraction * lookFraction,
				"winner alpha allocation",
			),
			regressionAlpha = finiteArithmetic(
				policy.alpha * policy.multiplicity.regression_fraction * lookFraction,
				"regression alpha allocation",
			);
		const radius = (a: number) => {
				if (!(a > 0 && a < 1))
					throw new TypeError("per-look alpha must be in (0,1)");
				const logarithm = finiteArithmetic(
						Math.log(1 / a),
						"confidence logarithm",
					),
					radicand = finiteArithmetic(
						logarithm / (2 * look),
						"confidence radicand",
					);
				if (radicand < 0)
					throw new TypeError("confidence radicand must be non-negative");
				return finiteArithmetic(
					differenceWidth * Math.sqrt(radicand),
					"confidence radius",
				);
			},
			lower = finiteArithmetic(
				Math.max(-range, mean - radius(winnerAlpha)),
				"confidence lower bound",
			),
			upper = finiteArithmetic(
				Math.min(range, mean + radius(regressionAlpha)),
				"confidence upper bound",
			);
		let lookDecision: AnytimeDecision = "continue";
		if (look >= policy.min_pairs) {
			if (lower > policy.practical_superiority_delta) lookDecision = "winner";
			else if (upper < -policy.regression_tolerance)
				lookDecision = "regression";
			else if (
				policy.futility.enabled &&
				look >= policy.futility.minimum_pairs &&
				lower >= policy.futility.equivalence_lower &&
				upper <= policy.futility.equivalence_upper &&
				(look < policy.max_pairs ||
					policy.futility.at_max === "futility-if-contained")
			)
				lookDecision = "futility";
			else if (look === policy.max_pairs) lookDecision = "inconclusive";
		}
		looks.push({
			look,
			scenario_differences: rows,
			weighted_difference: value,
			mean_difference: mean,
			confidence_sequence: {
				lower,
				upper,
				confidence: finiteArithmetic(1 - policy.alpha, "confidence"),
			},
			alpha_allocation: { winner: winnerAlpha, regression: regressionAlpha },
			boundaries: {
				winner: policy.practical_superiority_delta,
				regression: -policy.regression_tolerance,
				futility_lower: policy.futility.enabled
					? policy.futility.equivalence_lower
					: null,
				futility_upper: policy.futility.enabled
					? policy.futility.equivalence_upper
					: null,
			},
			decision: lookDecision,
		});
		if (lookDecision !== "continue") {
			decision = lookDecision;
			break;
		}
	}
	return {
		schema_version: "2.0",
		method: ANYTIME_QUALITY_METHOD,
		policy,
		policy_hash: digest(policy),
		observation_set_sha256: digest(observations),
		complete_pairs: complete,
		pending_observations:
			observations.length - complete * policy.scenarios.length,
		decision,
		terminal: decision !== "continue",
		looks,
	};
}
export function serializeAnytimeQualityResult(
	result: AnytimeQualityResult,
): string {
	return canonicalJson(result) + "\n";
}
function artifactFor(
	policyInput: unknown,
	observationInput: unknown,
): AnytimeQualityArtifact {
	const result = evaluateAnytimeQuality(policyInput, observationInput),
		observations = validateObservations(observationInput, result.policy),
		payload = {
			schema_version: ANYTIME_QUALITY_ARTIFACT_VERSION,
			artifact: "anytime-quality-decision" as const,
			integrity_notice: INTEGRITY_NOTICE,
			policy: result.policy,
			observations,
			result,
		};
	return { ...payload, artifact_sha256: digest(payload) };
}
export function serializeAnytimeQualityArtifact(
	artifact: AnytimeQualityArtifact,
): string {
	return canonicalJson(artifact) + "\n";
}
export function verifyAnytimeQualityArtifact(
	input: unknown,
): AnytimeQualityArtifact {
	exactObject(input, "artifact", [
		"schema_version",
		"artifact",
		"integrity_notice",
		"policy",
		"observations",
		"result",
		"artifact_sha256",
	]);
	const claimed = input as Record<string, unknown>;
	if (
		claimed.schema_version !== ANYTIME_QUALITY_ARTIFACT_VERSION ||
		claimed.artifact !== "anytime-quality-decision" ||
		claimed.integrity_notice !== INTEGRITY_NOTICE
	)
		throw new TypeError("unsupported anytime-quality artifact");
	if (
		typeof claimed.artifact_sha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(claimed.artifact_sha256)
	)
		throw new TypeError("artifact_sha256 must be lowercase SHA-256");
	const expected = artifactFor(claimed.policy, claimed.observations);
	if (claimed.artifact_sha256 !== expected.artifact_sha256)
		throw new Error("anytime-quality artifact hash mismatch");
	if (canonicalJson(claimed) !== canonicalJson(expected))
		throw new Error(
			"anytime-quality policy, observations, trace, hashes, or decision mismatch",
		);
	return expected;
}
export function readAndVerifyAnytimeQualityArtifact(
	path: string,
): AnytimeQualityArtifact {
	let fd: number | undefined;
	try {
		const named = lstatSync(path);
		if (named.isSymbolicLink() || !named.isFile())
			throw new TypeError(
				"anytime-quality artifact must be a regular non-symlink file",
			);
		fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const before = fstatSync(fd);
		if (before.dev !== named.dev || before.ino !== named.ino)
			throw new Error("anytime-quality artifact changed before it was opened");
		if (!before.isFile())
			throw new TypeError(
				"anytime-quality artifact must be a regular non-symlink file",
			);
		if (
			before.size <= 0 ||
			before.size > ANYTIME_QUALITY_CAPS.max_artifact_bytes
		)
			throw new TypeError("anytime-quality artifact exceeds the byte bound");
		const text = readFileSync(fd, { encoding: "utf8" });
		const after = fstatSync(fd);
		if (
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs ||
			after.ino !== before.ino ||
			Buffer.byteLength(text, "utf8") !== before.size
		)
			throw new Error("anytime-quality artifact changed while being read");
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new TypeError("anytime-quality artifact is not valid JSON");
		}
		const verified = verifyAnytimeQualityArtifact(parsed);
		if (text !== serializeAnytimeQualityArtifact(verified))
			throw new Error("anytime-quality artifact is not canonical");
		return verified;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
export function persistAnytimeQualityResult(
	path: string,
	policy: unknown,
	observations: unknown,
): AnytimeQualityResult {
	const artifact = artifactFor(policy, observations),
		serialized = serializeAnytimeQualityArtifact(artifact),
		bytes = Buffer.byteLength(serialized, "utf8");
	if (bytes <= 0 || bytes > ANYTIME_QUALITY_CAPS.max_artifact_bytes)
		throw new TypeError(
			"anytime-quality artifact exceeds the shared writer/reader byte bound",
		);
	const release = acquireDirectoryLockSync(path + ".lock");
	try {
		durableAtomicWrite(path, serialized);
		return artifact.result;
	} finally {
		release();
	}
}
