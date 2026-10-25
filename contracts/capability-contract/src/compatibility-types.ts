export const COMPATIBILITY_POLICY_VERSION = "1.0.0" as const;
export type CompatibilitySupportState = "supported" | "legacy-readable" | "unsupported" | "ambiguous";
export type CompatibilityKind = "envelope" | "workspace-layout" | "receipt" | "status-exit-family" | "shared-contract" | "schema-document" | "protocol-message" | "evaluation-definition" | "evaluation-artifact" | "review-artifact" | "public-api";
export type CompatibilityArtifactFormat = "json" | "jsonl" | "html" | "markdown" | "layout";
export type CompatibilityCreator = "shared" | "skill-creator" | "agent-creator" | "hook-creator" | "plugin-creator";
export interface CompatibilityDeprecation { window: string; replacement: string; }
export type CompatibilityValidatorId = string;
export interface CompatibilityEntry { id:string; creator:CompatibilityCreator; sourceFile:string; sourceFieldOrLayout:string; sourceEvidence:string; kind:CompatibilityKind; artifactFormat:CompatibilityArtifactFormat; readVersionsOrRanges:readonly string[]; emittedVersion:string|null; versionField:string|null; supportState:CompatibilitySupportState; deprecation:CompatibilityDeprecation|null; migrationId:string|null; validatorId:CompatibilityValidatorId; }
export type CompatibilityDiagnosticCode = "COMPATIBILITY_SURFACE_REQUIRED"|"COMPATIBILITY_SURFACE_UNKNOWN"|"COMPATIBILITY_MALFORMED_JSON"|"COMPATIBILITY_MALFORMED_JSONL"|"COMPATIBILITY_MALFORMED_HTML"|"COMPATIBILITY_MALFORMED_MARKDOWN"|"COMPATIBILITY_MALFORMED_LAYOUT"|"COMPATIBILITY_VERSION_REQUIRED"|"COMPATIBILITY_VERSION_UNSUPPORTED"|"COMPATIBILITY_SURFACE_AMBIGUOUS"|"COMPATIBILITY_LEGACY_UNVERSIONED"|"COMPATIBILITY_SHAPE_INVALID"|"COMPATIBILITY_SURFACE_NOT_SERIALIZED"|"MIGRATION_UNKNOWN"|"MIGRATION_PATH_UNSAFE"|"MIGRATION_ENTRY_UNSAFE"|"MIGRATION_SECRET_REJECTED"|"MIGRATION_SOURCE_CONFLICT"|"MIGRATION_NOT_APPLICABLE";
export interface CompatibilityDiagnostic { code:CompatibilityDiagnosticCode; severity:"info"|"warning"|"error"; path:string; message:string; remediation:string; }
export interface CompatibilityShapeValidationResult { valid:boolean; validatorId:CompatibilityValidatorId|null; diagnostic?:CompatibilityDiagnostic; }
export interface CompatibilityReadResult { ok:boolean; surfaceId:string|null; supportState:CompatibilitySupportState; detectedVersion:string|null; entry?:CompatibilityEntry; value?:unknown; diagnostics:CompatibilityDiagnostic[]; }
export interface MigrationInputFile { path:string; bytes:string|Uint8Array; entryType:"regular-file"|"directory"|"symlink"; symlinkTarget?:string; }
export interface MigrationPreviewOptions { migrationId:string; files:readonly MigrationInputFile[]; }
export interface MigrationCopyOperation { kind:"copy"; from:string; to:string; sourceSha256:string; preservesOriginal:true; }
export interface MigrationPreview { policyVersion:typeof COMPATIBILITY_POLICY_VERSION; migrationId:string; mode:"dry-run"; status:"ready"|"not-applicable"|"blocked"; originalSha256:Readonly<Record<string,string>>; operations:readonly MigrationCopyOperation[]; diff:string; diagnostics:readonly CompatibilityDiagnostic[]; sourceMutated:false; originalsPreserved:true; }
