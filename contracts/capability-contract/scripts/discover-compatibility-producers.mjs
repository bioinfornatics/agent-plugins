#!/usr/bin/env node
/** Source-only discovery helpers. This module never imports the compatibility registry. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function discoverHostDeclarations(source) {
  const exports = [...source.matchAll(/^export (?:interface|type|class) (Host[A-Za-z0-9]+)/gm)].map(match => match[1]);
  const begin = source.indexOf("export interface HostEventDataByType {");
  const end = source.indexOf("export type HostEventEnvelope", begin);
  if (begin < 0 || end < 0) throw new Error("HostEventDataByType declaration is missing");
  const eventVariants = source.slice(begin, end).split(/\r?\n/).map(line => /^  ([a-z]+): (.+);$/.exec(line)?.[1]).filter(Boolean);
  const protocolVersion = /HOST_ADAPTER_PROTOCOL_VERSION = "([^"]+)"/.exec(source)?.[1];
  if (!protocolVersion) throw new Error("HOST_ADAPTER_PROTOCOL_VERSION is missing");
  return { exports, eventVariants, protocolVersion };
}

export function discoverSchemaRegistrations(source) {
  const documents = /export type SchemaDocumentType = ([^;]+);/.exec(source)?.[1].match(/"([^"]+)"/g)?.map(value => value.slice(1, -1)) ?? [];
  const registrations = [...source.matchAll(/^\s*"([^"]+)":\s*registration\(\s*"([^"]+)"\s*,\s*"(published|draft)"\s*,\s*(true|false)(?:\s*,\s*(true|false))?\s*\),$/gm)].map(match => ({ version: match[1], declaredVersion: match[2], status: match[3], active: match[4] === "true", isDefault: match[5] === "true", documents }));
  return { documents, registrations };
}

export function discoverArtifactNames(source) {
  return [...new Set([...source.matchAll(/["']([A-Za-z0-9_.-]+\.(?:json|jsonl|html|md))["']/g)].map(match => match[1]))].sort();
}

export function discoverArtifactSurfaceMappings(source, rule, aliases, exclusions) {
  const discovered = discoverArtifactNames(source);
  if (JSON.stringify(discovered) !== JSON.stringify([...rule.expected].sort())) throw new Error("Artifact discovery drift for " + rule.sourceFile);
  const rows = [...aliases, ...exclusions].filter(row => row.sourceFile === rule.sourceFile);
  for (const row of rows) {
    const evidenceOccurrences = source.split(row.sourceEvidence).length - 1;
    if (!Number.isSafeInteger(row.evidenceOccurrences) || row.evidenceOccurrences < 1 || evidenceOccurrences !== row.evidenceOccurrences) {
      throw new Error("Artifact source evidence drift for " + (row.siteId ?? row.site) + ": expected " + row.evidenceOccurrences + " occurrence(s), found " + evidenceOccurrences);
    }
  }
  const mappings = [];
  for (const artifact of discovered) {
    const siteId = rule.sourceFile + "::" + artifact;
    const matches = rows.filter(row => (row.siteId ?? row.site) === siteId && row.sourceFieldOrArtifact === artifact);
    if (matches.length !== 1) throw new Error("Artifact site coverage drift for " + siteId + ": expected exactly one alias or exclusion, found " + matches.length);
    const row = matches[0];
    mappings.push({ siteId, artifact, classification: row.canonicalArtifactId ? "alias" : "exclusion", ...(row.canonicalArtifactId ? { canonicalArtifactId: row.canonicalArtifactId, role: row.role } : { rationale: row.rationale }) });
  }
  if (rows.length === 0) throw new Error("Artifact site coverage drift for " + rule.sourceFile + ": no significant sites are classified");
  return mappings;
}

export function discoverVersionEvidence(source, evidence) { return source.includes(evidence); }

export function discoverFromSources(manifest, loadSource) {
  const host = discoverHostDeclarations(loadSource(manifest.host.sourceFile));
  const schemaRegistry = discoverSchemaRegistrations(loadSource(manifest.schemaRegistry.sourceFile));
  const artifacts = manifest.artifactDiscovery.map(rule => { const source = loadSource(rule.sourceFile); return { sourceFile: rule.sourceFile, actual: discoverArtifactNames(source), mappings: discoverArtifactSurfaceMappings(source, rule, manifest.producerSiteAliases, manifest.structuralExclusions) }; });
  const versions = manifest.versionRules.map(rule => ({ id: rule.id, matched: discoverVersionEvidence(loadSource(rule.versionSourceFile), rule.versionEvidence), emittedVersion: rule.emittedVersion }));
  return { host, schemaRegistry, artifacts, versions };
}

if (process.argv[1] && import.meta.url === new URL("file:" + resolve(process.argv[1])).href) {
  const repositoryRoot = resolve(process.argv[2] ?? process.cwd());
  const manifestPath = resolve(repositoryRoot, "contracts/capability-contract/fixtures/compatibility/producer-discovery.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  process.stdout.write(JSON.stringify(discoverFromSources(manifest, file => readFileSync(resolve(repositoryRoot, file), "utf8")), null, 2) + "\n");
}
