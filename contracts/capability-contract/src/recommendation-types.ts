export const ARTIFACT_RECOMMENDATION_VERSION = "1.0.0" as const;

export const ARTIFACT_TYPES = ["skill", "agent", "hook", "mcp", "recipe", "plugin"] as const;
export type RecommendedArtifactType = (typeof ARTIFACT_TYPES)[number];

export type OverrideDisposition = "not-requested" | "respected" | "unsafe" | "unsupported";
export type PortabilityLevel = "high" | "medium" | "low";

export interface ArtifactRecommendationRequestV1 {
  version: typeof ARTIFACT_RECOMMENDATION_VERSION;
  outcome: string;
  explicitType?: string;
}

export interface ArtifactAlternativeV1 {
  type: RecommendedArtifactType;
  rationale: string;
}

export interface ArtifactPortabilityV1 {
  level: PortabilityLevel;
  scope: string;
}

export interface ArtifactCreatorBridgeV1 {
  status: "available" | "unavailable";
  target?: string;
  reason?: string;
}

export interface ArtifactOverrideV1 {
  requested?: string;
  disposition: OverrideDisposition;
  reason: string;
}

export interface ArtifactRecommendationV1 {
  version: typeof ARTIFACT_RECOMMENDATION_VERSION;
  recommendation: RecommendedArtifactType;
  confidence: number;
  alternatives: ArtifactAlternativeV1[];
  assumptions: string[];
  rationale: string;
  question?: string;
  portability: ArtifactPortabilityV1;
  creatorBridge: ArtifactCreatorBridgeV1;
  override: ArtifactOverrideV1;
}
