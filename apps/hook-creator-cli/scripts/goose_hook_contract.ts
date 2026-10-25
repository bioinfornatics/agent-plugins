/** Source-verified Goose hook profiles. Not a claim about a running binary. */
export const GOOSE_TARGETS = {
  'v1.47.0': { commit: 'f9c7aaccde4834810dfd13d5efa8f0d39ba28a20', outcomeEvent: false },
  'main-2b17adc': { commit: '2b17adc33a7176e701c2fef9578a5fc5834ea89a', outcomeEvent: true },
} as const;
export type GooseTarget = keyof typeof GOOSE_TARGETS;
export const DEFAULT_GOOSE_TARGET: GooseTarget = 'v1.47.0';
export function gooseTarget(value: string): GooseTarget {
  if (!Object.hasOwn(GOOSE_TARGETS,value)) throw new Error('Unknown Goose target: '+value+'; select v1.47.0 or main-2b17adc');
  return value as GooseTarget;
}
export function hookEvents(target: GooseTarget = DEFAULT_GOOSE_TARGET): Set<string> {
  const events = new Set(['SessionStart','SessionEnd','Stop','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','BeforeReadFile','AfterFileEdit','BeforeShellExecution','AfterShellExecution']);
  if(GOOSE_TARGETS[target].outcomeEvent) events.add('PreToolUseResult');
  return events;
}
export const BLOCKING_EVENTS = new Set(['PreToolUse','Stop']);
export const NATIVE_HOOKS_PATH = 'hooks/hooks.json';
export const ADAPTER_HOOKS_PATH = 'extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json';
export const ADAPTER_LIMIT = 'Distributor adapter hooks are not loaded natively by either recorded Goose target; activation requires a separately verified adapter. No migration from hooks/hooks.json is recommended.';
