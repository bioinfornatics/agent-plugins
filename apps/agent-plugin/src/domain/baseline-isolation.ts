import type { EvaluationProfile } from "./evaluation.ts";

/** A scenario prompt that names a profile Skill's SKILL.md path (ap-15xv). */
export interface BaselineIsolationRisk { scenarioId: string; skillDirectory: string }

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Nonblocking suite check: trials share the operator's UID, so a Without-arm agent told
 * where a profile SKILL.md lives can often read a real checkout of it (observed in
 * campaign b92185d5, eval-3/eval-8). Matching uses whole path segments of the Skill
 * directory name followed by SKILL.md; it never proves or excludes contamination, which
 * the structural activation oracle (product §31) observes after execution. The pattern has
 * no prefix group (linear time on long prompts) and the result carries no prompt text, so
 * advisories never echo private absolute paths or prompt content.
 */
export function baselineIsolationRisks(profile: EvaluationProfile): BaselineIsolationRisk[] {
  const directories = [...new Set(profile.components.flatMap(component => component.skillRoots.map(root => root.split(/[\\/]/).filter(Boolean).at(-1) ?? "")).filter(Boolean))].sort();
  const risks: BaselineIsolationRisk[] = [];
  for (const scenario of profile.scenarios) {
    for (const directory of directories) {
      const pattern = new RegExp(`(?<![A-Za-z0-9._-])${escapeRegExp(directory)}[\\\\/]SKILL\\.md(?![A-Za-z0-9_-])`);
      if (pattern.test(scenario.prompt)) risks.push({ scenarioId: scenario.id, skillDirectory: directory });
    }
  }
  return risks;
}
