import type { RunTelemetry, TelemetryObserver } from "../../../../application/ports/telemetry-observer.ts";
import { record } from "./goose-configuration.ts";

export const gooseTelemetrySource = "goose stream-json complete event";
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Goose `run --output-format stream-json` (observed on v1.57.0) ends a finished session with
 * one `{"type":"complete", total_tokens, input_tokens, output_tokens, cache_read_input_tokens,
 * cache_write_input_tokens, cost_usd}` line. Only that final line is trusted: an interrupted
 * session has none, and an earlier or repeated event is not a session total. Totals are
 * cumulative over every turn, including re-sent context. Malformed values are unavailable,
 * never coerced to zero. Returns undefined when no usable event exists. */
export function observeGooseTelemetry(stream: string): RunTelemetry | undefined {
  const lines = stream.split("\n").filter(line => line.trim());
  const events = lines.map(line => { try { return JSON.parse(line) as unknown; } catch { return undefined; } });
  const completes = events.filter(event => record(event) && event.type === "complete");
  const last = events.at(-1);
  if (completes.length !== 1 || completes[0] !== last || !record(last)) return undefined;
  // Copied as reported: no total === input + output check, since providers may count cache
  // or reasoning tokens differently; inconsistency is the host's claim, not ours to repair.
  const total = count(last.total_tokens), input = count(last.input_tokens), output = count(last.output_tokens);
  const tokens = total !== undefined && input !== undefined && output !== undefined
    ? { total, input, output, cacheRead: count(last.cache_read_input_tokens) ?? null, cacheWrite: count(last.cache_write_input_tokens) ?? null } : null;
  const costUsd = typeof last.cost_usd === "number" && Number.isFinite(last.cost_usd) && last.cost_usd >= 0 ? last.cost_usd : null;
  return tokens || costUsd !== null ? { source: gooseTelemetrySource, tokens, costUsd } : undefined;
}

export class GooseTelemetryObserver implements TelemetryObserver {
  observe(input: Parameters<TelemetryObserver["observe"]>[0]): RunTelemetry | undefined {
    if (input.agent !== "goose") return undefined;
    const artifact = input.artifacts.find(a => a.path === "goose/stream.jsonl");
    if (!artifact) return undefined;
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.content); } catch { return undefined; }
    return observeGooseTelemetry(text);
  }
}
