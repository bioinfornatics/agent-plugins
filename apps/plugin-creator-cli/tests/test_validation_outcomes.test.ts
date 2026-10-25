import { test } from "node:test";
import assert from "node:assert/strict";
import { assertTypedDiagnostic, createValidationOutcome, legacyExitCode, type TypedDiagnostic } from "../dist/scripts/validation_outcomes.js";
const diagnostic = (scope: TypedDiagnostic["scope"], severity: TypedDiagnostic["severity"]): TypedDiagnostic => ({ code:"manifest.unknown-field", rule:"Agent Plugins 1.0.0 §5", message:"Unknown field is ignored", severity, scope, sourcePath:"plugin.json", remediation:"Remove the field for strict authoring." });
test("typed outcomes preserve normative scopes and partial loading",()=>{
  const result=createValidationOutcome("portable-load",[diagnostic("component-entry","error")],[{status:"skipped",scope:"component-entry",sourcePath:"skills/bad/SKILL.md",componentType:"skill",componentId:"bad",diagnostics:[]}]);
  assert.equal(result.status,"partial"); assert.equal(legacyExitCode(result),1);
});
test("plugin-fatal diagnostics reject while warnings remain accepted",()=>{
  assert.equal(createValidationOutcome("portable-load",[diagnostic("plugin","error")]).status,"rejected");
  assert.equal(createValidationOutcome("strict-authoring",[diagnostic("plugin","warning")]).status,"accepted");
});
test("diagnostics require actionable stable fields",()=>{
  assert.doesNotThrow(()=>assertTypedDiagnostic(diagnostic("plugin","warning")));
  assert.throws(()=>assertTypedDiagnostic({...diagnostic("plugin","warning"),remediation:""}),/remediation/);
});
test("unsupported compatibility exit is distinct from accepted",()=>{
  assert.equal(legacyExitCode({mode:"portable-load",status:"unsupported",diagnostics:[],components:[]}),3);
});
