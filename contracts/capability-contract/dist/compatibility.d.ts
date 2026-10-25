import type { CompatibilityEntry, CompatibilityReadResult, MigrationPreview, MigrationPreviewOptions } from "./compatibility-types.js";
export declare const COMPATIBILITY_REGISTRY: readonly CompatibilityEntry[];
export declare const RESULT_CONTRACT_REFERENCE: Readonly<{
    version: "1.0.0";
    schemaId: "https://agent-plugins.org/schemas/result-contract/1.0.0/result-contract.schema.json";
    mappingExport: "LEGACY_STATUS_MAPPINGS";
    classifierExport: "classifyResultExit";
}>;
export declare function getCompatibilityEntry(id: string): CompatibilityEntry | undefined;
export declare function validateSurfaceShape(surfaceId: string, value: unknown): import("./compatibility-types.js").CompatibilityShapeValidationResult;
export declare function readPublicSurface(input: string | Uint8Array, surfaceId?: string): CompatibilityReadResult;
/** Maximum bytes inspected per file by migration preview. */
export declare const MIGRATION_PREVIEW_MAX_FILE_BYTES: number;
/** Maximum aggregate bytes accepted by migration preview before content inspection. */
export declare const MIGRATION_PREVIEW_MAX_TOTAL_BYTES: number;
/** Maximum file entries accepted by migration preview before any entry is inspected. */
export declare const MIGRATION_PREVIEW_MAX_FILE_ENTRIES = 10000;
export declare function previewMigration(options: MigrationPreviewOptions): MigrationPreview;
