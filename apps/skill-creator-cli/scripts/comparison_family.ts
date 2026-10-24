import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
	acquireDirectoryLockSync,
	durableAtomicWrite,
} from "./durable_file.js";
import { canonicalJson } from "./anytime_quality.js";
export interface ComparisonFamilyPlan {
	id: string;
	index: number;
	weight: number;
}
export interface ComparisonFamilyConfiguration {
	schema_version: "2.0";
	family_id: string;
	global_alpha: number;
	comparisons: ComparisonFamilyPlan[];
}
export interface ComparisonClaim {
	comparison_id: string;
	comparison_index: number;
	campaign_id: string;
	campaign_workspace: string;
	allocated_alpha: number;
	status: "claimed" | "prepared" | "verified-final";
	prepared_result_hash: string | null;
	verification_hash: string | null;
}
/**
 * Persistence invariant: configuration is immutable after creation; claims move
 * monotonically from claimed to prepared to verified-final under one lock.
 */
export interface ComparisonFamilyManifest {
	schema_version: "2.0";
	artifact: "comparison-family-manifest";
	authority: { root: string; family_id: string };
	configuration: ComparisonFamilyConfiguration;
	configuration_hash: string;
	claims: ComparisonClaim[];
	revision: number;
	state_hash: string;
}
const ID = /^[-A-Za-z0-9_.:]{1,128}$/,
	HEX = /^[a-f0-9]{64}$/;
const sha = (x: unknown) =>
	createHash("sha256").update(canonicalJson(x)).digest("hex");
interface FamilyConfigurationBoundary {
	schema_version?: unknown;
	family_id?: unknown;
	global_alpha?: unknown;
	comparisons?: unknown;
}

/** Family manifests accept only exact shapes before canonical hash checking. */
function exact(x: unknown, keys: string[], label: string): void {
	if (
		!x ||
		typeof x !== "object" ||
		Array.isArray(x) ||
		Object.keys(x).sort().join("\0") !== [...keys].sort().join("\0")
	)
		throw new TypeError(label + " has an invalid shape");
}
export function validateFamilyConfiguration(
	x: unknown,
): ComparisonFamilyConfiguration {
	exact(
		x,
		["schema_version", "family_id", "global_alpha", "comparisons"],
		"family configuration",
	);
	const v = x as FamilyConfigurationBoundary & {
		comparisons: unknown[];
	};
	if (
		v.schema_version !== "2.0" ||
		typeof v.family_id !== "string" ||
		!ID.test(v.family_id)
	)
		throw new TypeError("invalid family identity");
	if (
		typeof v.global_alpha !== "number" ||
		!Number.isFinite(v.global_alpha) ||
		v.global_alpha < 1e-12 ||
		v.global_alpha >= 1
	)
		throw new TypeError("invalid family global_alpha");
	if (
		!Array.isArray(v.comparisons) ||
		!v.comparisons.length ||
		v.comparisons.length > 1024
	)
		throw new TypeError("family comparisons must be a non-empty bounded array");
	const ids = new Set(),
		indexes = new Set();
	const comparisons = v.comparisons
		.map((candidate: unknown, i: number): ComparisonFamilyPlan => {
			exact(candidate, ["id", "index", "weight"], "comparison " + i);
			const c = candidate as {
				id: unknown;
				index: unknown;
				weight: unknown;
			};
			if (typeof c.id !== "string" || !ID.test(c.id) || ids.has(c.id))
				throw new TypeError(
					"comparison ids must be unique portable identifiers",
				);
			if (
				typeof c.index !== "number" ||
				!Number.isSafeInteger(c.index) ||
				c.index < 1 ||
				c.index > v.comparisons.length ||
				indexes.has(c.index)
			)
				throw new TypeError("comparison indexes must be unique and contiguous");
			if (
				typeof c.weight !== "number" ||
				!Number.isFinite(c.weight) ||
				c.weight <= 0
			)
				throw new TypeError("comparison weights must be positive");
			ids.add(c.id);
			indexes.add(c.index);
			return { id: c.id, index: c.index, weight: c.weight };
		})
		.sort((a, b) => a.index - b.index);
	if (comparisons.some((c, i) => c.index !== i + 1))
		throw new TypeError("comparison indexes must be contiguous");
	return {
		schema_version: "2.0",
		family_id: v.family_id,
		global_alpha: v.global_alpha,
		comparisons,
	};
}
export const familyConfigurationHash = (x: unknown) =>
	sha(validateFamilyConfiguration(x));
function repositoryRoot(skillPath: string): string {
	let p = resolve(skillPath);
	for (;;) {
		if (existsSync(join(p, ".git")) || existsSync(join(p, "plugin.json")))
			return p;
		const up = dirname(p);
		if (up === p) return dirname(resolve(skillPath));
		p = up;
	}
}
export function canonicalFamilyManifestPath(
	skillPath: string,
	familyId: string,
	requestedRoot?: string,
): string {
	if (!ID.test(familyId)) throw new TypeError("invalid family identity");
	const root = join(
		repositoryRoot(skillPath),
		".evaluation-control",
		"comparison-families",
	);
	if (requestedRoot && resolve(requestedRoot) !== resolve(root))
		throw new Error("alternate comparison family registry root is forbidden");
	return join(root, encodeURIComponent(familyId), "family-manifest.json");
}
function body(
	manifest: ComparisonFamilyManifest,
): Omit<ComparisonFamilyManifest, "state_hash"> {
	const { state_hash: _ignored, ...payload } = manifest;
	return payload;
}
function canonical(
	manifest: Omit<ComparisonFamilyManifest, "state_hash">,
): ComparisonFamilyManifest {
	return {
		...manifest,
		claims: [...manifest.claims].sort(
			(a, b) => a.comparison_index - b.comparison_index,
		),
		state_hash: sha(manifest),
	};
}
function read(path: string): ComparisonFamilyManifest {
	const stat = lstatSync(path);
	if (
		stat.isSymbolicLink() ||
		!stat.isFile() ||
		stat.size <= 0 ||
		stat.size > 1024 * 1024
	)
		throw new Error("family manifest must be a bounded regular file");
	const raw = JSON.parse(readFileSync(path, "utf8"));
	exact(
		raw,
		[
			"schema_version",
			"artifact",
			"authority",
			"configuration",
			"configuration_hash",
			"claims",
			"revision",
			"state_hash",
		],
		"family manifest",
	);
	exact(raw.authority, ["root", "family_id"], "family authority");
	const config = validateFamilyConfiguration(raw.configuration);
	if (
		resolve(raw.authority.root) !== dirname(resolve(path)) ||
		raw.authority.family_id !== config.family_id
	)
		throw new Error("family authority identity mismatch");
	for (const c of raw.claims) {
		exact(
			c,
			[
				"comparison_id",
				"comparison_index",
				"campaign_id",
				"campaign_workspace",
				"allocated_alpha",
				"status",
				"prepared_result_hash",
				"verification_hash",
			],
			"family claim",
		);
		if (!["claimed", "prepared", "verified-final"].includes(c.status))
			throw new Error("invalid family claim state");
		if (c.prepared_result_hash !== null && !HEX.test(c.prepared_result_hash))
			throw new Error("invalid prepared result hash");
		if (c.status === "verified-final" && !HEX.test(c.verification_hash))
			throw new Error("invalid verification hash");
	}
	const expected = canonical({
		schema_version: "2.0",
		artifact: "comparison-family-manifest",
		authority: raw.authority,
		configuration: config,
		configuration_hash: familyConfigurationHash(config),
		claims: raw.claims,
		revision: raw.revision,
	});
	if (canonicalJson(raw) !== canonicalJson(expected))
		throw new Error(
			"family manifest is noncanonical, corrupt, or configuration drifted",
		);
	return expected;
}
function write(path: string, m: ComparisonFamilyManifest) {
	durableAtomicWrite(path, JSON.stringify(m, null, 2) + "\n");
}
function empty(path: string, c: ComparisonFamilyConfiguration) {
	return canonical({
		schema_version: "2.0",
		artifact: "comparison-family-manifest",
		authority: { root: dirname(resolve(path)), family_id: c.family_id },
		configuration: c,
		configuration_hash: familyConfigurationHash(c),
		claims: [],
		revision: 0,
	});
}
export function initializeFamilyManifest(path: string, configuration: unknown) {
	const target = resolve(path),
		config = validateFamilyConfiguration(configuration),
		release = acquireDirectoryLockSync(target + ".lock");
	try {
		if (existsSync(target)) {
			const current = read(target);
			if (current.configuration_hash !== familyConfigurationHash(config))
				throw new Error("comparison family configuration is immutable");
			return current;
		}
		const m = empty(target, config);
		write(target, m);
		return m;
	} finally {
		release();
	}
}
export function claimFamilyComparison(
	path: string,
	configuration: unknown,
	comparisonId: string,
	campaignId: string,
	campaignWorkspace: string,
) {
	const target = resolve(path),
		config = validateFamilyConfiguration(configuration),
		release = acquireDirectoryLockSync(target + ".lock");
	try {
		let m = existsSync(target) ? read(target) : empty(target, config);
		if (m.configuration_hash !== familyConfigurationHash(config))
			throw new Error("comparison family configuration is immutable");
		const planned = config.comparisons.find((x) => x.id === comparisonId);
		if (!planned) throw new Error("comparison is not in the planned family");
		const prior = m.claims.find(
			(x) =>
				x.comparison_id === comparisonId ||
				x.comparison_index === planned.index,
		);
		if (
			prior &&
			(prior.campaign_id !== campaignId ||
				prior.campaign_workspace !== resolve(campaignWorkspace))
		)
			throw new Error(
				"comparison family allocation is already claimed by another campaign",
			);
		const total = config.comparisons.reduce((n, x) => n + x.weight, 0),
			claim = prior ?? {
				comparison_id: planned.id,
				comparison_index: planned.index,
				campaign_id: campaignId,
				campaign_workspace: resolve(campaignWorkspace),
				allocated_alpha: (config.global_alpha * planned.weight) / total,
				status: "claimed" as const,
				prepared_result_hash: null,
				verification_hash: null,
			};
		if (!prior) {
			m = canonical({
				...body(m),
				claims: [...m.claims, claim],
				revision: m.revision + 1,
			});
			write(target, m);
		}
		return { manifest: m, claim };
	} finally {
		release();
	}
}
/** Atomically preclaim a complete matrix family before any cell executes. */
export function claimFamilyComparisons(
	path: string,
	configuration: unknown,
	claims: Array<{
		comparisonId: string;
		campaignId: string;
		campaignWorkspace: string;
	}>,
) {
	const target = resolve(path),
		config = validateFamilyConfiguration(configuration),
		release = acquireDirectoryLockSync(target + ".lock");
	try {
		let m = existsSync(target) ? read(target) : empty(target, config);
		if (m.configuration_hash !== familyConfigurationHash(config))
			throw new Error("comparison family configuration is immutable");
		if (claims.length !== config.comparisons.length)
			throw new Error("matrix preclaim must cover every planned comparison");
		const total = config.comparisons.reduce((n, x) => n + x.weight, 0),
			seen = new Set<string>(),
			next = [...m.claims];
		for (const requested of claims) {
			if (seen.has(requested.comparisonId))
				throw new Error("duplicate matrix family preclaim");
			seen.add(requested.comparisonId);
			const planned = config.comparisons.find(
				(x) => x.id === requested.comparisonId,
			);
			if (!planned) throw new Error("comparison is not in the planned family");
			const prior = next.find(
				(x) =>
					x.comparison_id === planned.id ||
					x.comparison_index === planned.index,
			);
			if (
				prior &&
				(prior.campaign_id !== requested.campaignId ||
					prior.campaign_workspace !== resolve(requested.campaignWorkspace))
			)
				throw new Error(
					"comparison family allocation is already claimed by another campaign",
				);
			if (!prior)
				next.push({
					comparison_id: planned.id,
					comparison_index: planned.index,
					campaign_id: requested.campaignId,
					campaign_workspace: resolve(requested.campaignWorkspace),
					allocated_alpha: (config.global_alpha * planned.weight) / total,
					status: "claimed",
					prepared_result_hash: null,
					verification_hash: null,
				});
		}
		if (
			seen.size !== config.comparisons.length ||
			config.comparisons.some((x) => !seen.has(x.id))
		)
			throw new Error(
				"matrix preclaim does not exactly match the planned family",
			);
		if (next.length !== m.claims.length) {
			m = canonical({ ...body(m), claims: next, revision: m.revision + 1 });
			write(target, m);
		}
		return m;
	} finally {
		release();
	}
}
export function prepareFamilyComparison(
	path: string,
	campaignId: string,
	resultHash: string,
) {
	if (!HEX.test(resultHash)) throw new TypeError("resultHash must be SHA-256");
	const target = resolve(path),
		release = acquireDirectoryLockSync(target + ".lock");
	try {
		let m = read(target),
			i = m.claims.findIndex((x) => x.campaign_id === campaignId);
		if (i < 0) throw new Error("campaign has no family allocation claim");
		const prior = m.claims[i];
		if (prior.prepared_result_hash && prior.prepared_result_hash !== resultHash)
			throw new Error("prepared family result is immutable");
		if (prior.status === "claimed") {
			const claims = [...m.claims];
			claims[i] = {
				...prior,
				status: "prepared",
				prepared_result_hash: resultHash,
			};
			m = canonical({ ...body(m), claims, revision: m.revision + 1 });
			write(target, m);
		}
		return m;
	} finally {
		release();
	}
}
export function finalizeFamilyComparison(
	path: string,
	campaignId: string,
	resultHash: string,
	verificationHash: string,
) {
	if (!HEX.test(resultHash) || !HEX.test(verificationHash))
		throw new TypeError("final hashes must be SHA-256");
	const target = resolve(path),
		release = acquireDirectoryLockSync(target + ".lock");
	try {
		let m = read(target),
			i = m.claims.findIndex((x) => x.campaign_id === campaignId);
		if (i < 0) throw new Error("campaign has no family allocation claim");
		const prior = m.claims[i];
		if (prior.status === "claimed" || prior.prepared_result_hash !== resultHash)
			throw new Error(
				"family result must be prepared before verified finalization",
			);
		if (
			prior.status === "verified-final" &&
			prior.verification_hash !== verificationHash
		)
			throw new Error("final family verification is immutable");
		if (prior.status !== "verified-final") {
			const claims = [...m.claims];
			claims[i] = {
				...prior,
				status: "verified-final",
				verification_hash: verificationHash,
			};
			m = canonical({ ...body(m), claims, revision: m.revision + 1 });
			write(target, m);
		}
		return m;
	} finally {
		release();
	}
}
export function familyConclusion(m: ComparisonFamilyManifest) {
	const planned = m.configuration.comparisons.length,
		registered = m.claims.length,
		prepared = m.claims.filter((x) => x.status === "prepared").length,
		final = m.claims.filter((x) => x.status === "verified-final").length,
		complete = registered === planned && final === planned;
	return {
		family_id: m.configuration.family_id,
		configuration_hash: m.configuration_hash,
		state_hash: m.state_hash,
		planned_comparisons: planned,
		registered_comparisons: registered,
		prepared_comparisons: prepared,
		final_comparisons: final,
		status: complete ? "complete-family" : "partial-family",
		familywide_conclusion: complete ? "eligible" : "none",
	};
}
export const readFamilyManifest = (path: string) => read(resolve(path));
