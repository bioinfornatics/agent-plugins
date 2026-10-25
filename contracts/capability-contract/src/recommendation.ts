import {
  ARTIFACT_RECOMMENDATION_VERSION,
  ARTIFACT_TYPES,
  type ArtifactCreatorBridgeV1,
  type ArtifactPortabilityV1,
  type ArtifactRecommendationRequestV1,
  type ArtifactRecommendationV1,
  type RecommendedArtifactType,
} from "./recommendation-types.js";

interface Rule { type: RecommendedArtifactType; keywords: readonly RegExp[]; rationale: string }

const RULES: readonly Rule[] = [
  { type: "skill", keywords: [/\bprocedure\b/i, /\binstructions?\b/i, /\bhow[- ]to\b/i, /\breusable guidance\b/i, /\bbest practices?\b/i], rationale: "Reusable instructions or a procedure belong in a Skill." },
  { type: "agent", keywords: [/\bagent\b/i, /\bpersona\b/i, /\brole\b/i, /\bdelegate\b/i, /\bautonomous(?:ly)?\b/i, /\bspecialist\b/i], rationale: "A delegated role with independent judgment belongs in an agent." },
  { type: "hook", keywords: [/\bhook\b/i, /\bpre[- ]?tool\b/i, /\bpost[- ]?tool\b/i, /\bon (?:every|each)\b/i, /\bevent[- ]driven\b/i, /\bautomatically (?:block|enforce|validate|run)\b/i], rationale: "Event-triggered enforcement belongs in a hook." },
  { type: "mcp", keywords: [/\bmcp\b/i, /\btool server\b/i, /\bexpose (?:an? )?(?:api|tool|resource)\b/i, /\bexternal (?:api|service|system)\b/i, /\bprotocol server\b/i, /\btools? for (?:accessing|querying|calling)\b/i], rationale: "A tool or resource boundary for an external capability belongs in an MCP server." },
  { type: "recipe", keywords: [/\brecipe\b/i, /\borchestrat(?:e|ion)\b/i, /\bsequence\b/i, /\bmulti[- ]step\b/i, /\bchain (?:skills|agents|steps)\b/i, /\bworkflow across\b/i], rationale: "A reusable orchestration sequence belongs in a recipe." },
  { type: "plugin", keywords: [/\bplugin\b/i, /\bbundle\b/i, /\bdistribution\b/i, /\bpackage (?:skills|agents|hooks|components)\b/i, /\bskills?.{0,20}agents?\b/i, /\bmultiple (?:artifact|component) types\b/i], rationale: "A distributable combination of capability types belongs in a plugin." },
] as const;

const PORTABILITY: Readonly<Record<RecommendedArtifactType, ArtifactPortabilityV1>> = {
  skill: { level: "high", scope: "Open-format instructions are portable to hosts that implement the Agent Skills format." },
  agent: { level: "medium", scope: "The role and instructions are portable, but agent manifests and runtime behavior require host adaptation." },
  hook: { level: "low", scope: "Hook events, payloads, and lifecycle semantics are runtime-specific." },
  mcp: { level: "high", scope: "The MCP protocol boundary is portable across compatible clients; deployment and credentials remain environment-specific." },
  recipe: { level: "low", scope: "Recipe orchestration is a Goose runtime convention and is not claimed as a cross-host standard." },
  plugin: { level: "low", scope: "The open component formats may travel independently, but plugin packaging and installation are runtime-specific." },
};

const BRIDGES: Readonly<Record<RecommendedArtifactType, ArtifactCreatorBridgeV1>> = {
  skill: { status: "available", target: "agent-plugins:skill-creator" },
  agent: { status: "available", target: "agent-plugins:agent-creator" },
  hook: { status: "available", target: "agent-plugins:hook-creator" },
  plugin: { status: "available", target: "agent-plugins:plugin-creator" },
  mcp: { status: "unavailable", reason: "This distribution does not expose an MCP-server creator." },
  recipe: { status: "unavailable", reason: "This distribution does not expose a recipe creator." },
};

const UNSAFE = /\b(?:bypass|disable|evade|remove) (?:security|safety|approval|authorization|authentication|audit|guardrails?)\b|\b(?:steal|exfiltrate) (?:credentials?|secrets?|data)\b/i;
const OWN = Object.prototype.hasOwnProperty;

function assertRequest(value: unknown): asserts value is ArtifactRecommendationRequestV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("request must be an object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!["version", "outcome", "explicitType"].includes(key)) throw new TypeError(`unknown request property: ${key}`);
  if (input.version !== ARTIFACT_RECOMMENDATION_VERSION) throw new TypeError("version must be 1.0.0");
  if (typeof input.outcome !== "string" || input.outcome.trim().length === 0 || input.outcome.length > 4000) throw new TypeError("outcome must be a non-empty string of at most 4000 characters");
  if (OWN.call(input, "explicitType") && (typeof input.explicitType !== "string" || input.explicitType.trim().length === 0 || input.explicitType.length > 64)) throw new TypeError("explicitType must be a non-empty string of at most 64 characters");
}

export function recommendArtifact(input: unknown): ArtifactRecommendationV1 {
  assertRequest(input);
  const outcome = input.outcome.trim();
  const ranked = RULES.map((rule, index) => ({ rule, index, score: rule.keywords.reduce((n, pattern) => n + (pattern.test(outcome) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const ambiguous = ranked[0].score === 0 || ranked[0].score === ranked[1].score;
  const inferred = ranked[0].score === 0 ? RULES[0] : ranked[0].rule;
  const requested = input.explicitType?.trim().toLowerCase();
  const supported = requested !== undefined && (ARTIFACT_TYPES as readonly string[]).includes(requested);
  const unsafe = requested !== undefined && UNSAFE.test(outcome);
  let selected = inferred.type;
  let override: ArtifactRecommendationV1["override"] = { disposition: "not-requested", reason: "No explicit artifact type was requested." };
  if (requested !== undefined && !supported) override = { requested: input.explicitType, disposition: "unsupported", reason: "The requested type is not one of skill, agent, hook, mcp, recipe, or plugin." };
  else if (requested !== undefined && unsafe) override = { requested, disposition: "unsafe", reason: "The requested override was not applied because the stated outcome seeks to bypass a safety or security control." };
  else if (requested !== undefined) { selected = requested as RecommendedArtifactType; override = { requested, disposition: "respected", reason: "The explicit supported choice takes precedence over inferred routing." }; }
  const alternatives = ranked.filter(({ rule }) => rule.type !== selected).slice(0, ambiguous ? 2 : 1).map(({ rule }) => ({ type: rule.type, rationale: rule.rationale }));
  const confidence = override.disposition === "respected" ? 1 : ambiguous ? 0.4 : Math.min(0.95, 0.65 + ranked[0].score * 0.1);
  return {
    version: ARTIFACT_RECOMMENDATION_VERSION,
    recommendation: selected,
    confidence,
    alternatives,
    assumptions: ["The request asks for one primary artifact recommendation.", "Recommendation is advisory and creates or modifies no files."],
    rationale: selected === inferred.type ? inferred.rationale : `The explicit ${selected} choice was respected. Inferred routing would otherwise recommend ${inferred.type}.`,
    ...(ambiguous && override.disposition !== "respected" ? { question: "Should this primarily provide reusable instructions, act as a delegated role, react to runtime events, expose tools, orchestrate steps, or bundle multiple component types?" } : {}),
    portability: { ...PORTABILITY[selected] },
    creatorBridge: { ...BRIDGES[selected] },
    override,
  };
}
