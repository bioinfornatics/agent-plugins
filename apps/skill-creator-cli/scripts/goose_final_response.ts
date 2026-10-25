// Shared candidate/grader response selection for Goose stream-json.
// v1.55.0 session/mod.rs emits telemetry-only Complete. reply_parts.rs assigns
// one ID to mergeable chunks; inference.rs emits each chunk, NOT a cumulative
// snapshot. Repeated text (even identical text) under that ID must be appended.
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}
function invalid(reason: string): never {
  throw new Error("Goose final response unavailable: " + reason);
}
function visibleText(content: unknown): string {
  if (!Array.isArray(content)) return invalid("unsupported message content");
  return content.map(value => {
    const block = record(value);
    if (block.type !== "text") return ""; // Never descend into tools/thinking.
    const audience = record(block.annotations).audience;
    if (audience !== undefined && (!Array.isArray(audience) || !audience.includes("user"))) return "";
    if (typeof block.text !== "string") return invalid("unsupported text block");
    return block.text;
  }).join("");
}

/** Completion has already been checked for success by the caller. */
export function gooseFinalResponse(events: RecordValue[], terminal: RecordValue, malformedRecords = 0): string {
  const end = events.indexOf(terminal);
  if (end < 0 || events.slice(0, end).some(event => event.type === "complete") || events.slice(end + 1).some(event => event.type === "message" || event.type === "complete")) {
    return invalid("message or completion after terminal boundary");
  }
  // Explicit response envelopes are supported by existing command adapters.
  // Strings are literal task output, including JSON-looking strings.
  for (const key of ["output", "response", "message", "result"]) {
    if (terminal[key] === undefined || terminal[key] === null) continue;
    const value = terminal[key];
    if (typeof value !== "string") return invalid("unsupported terminal response");
    if (!value.trim()) return invalid("empty terminal response");
    return value;
  }

  if (malformedRecords) return invalid("malformed records obscure response boundaries");
  let current: { id: string | null; output: string; blocked: boolean } | null = null;
  const closedIds = new Set<string>();
  const close = () => {
    if (current?.id !== null && current?.id !== undefined) closedIds.add(current.id);
    current = null;
  };
  for (const event of events.slice(0, end)) {
    if (event.type === "notification" || event.type === "progress") continue;
    if (event.type !== "message") return invalid("unsupported event obscures response boundaries");
    const message = record(event.message), metadata = record(message.metadata);
    const id = typeof message.id === "string" && message.id.length ? message.id : null;
    if (message.id !== undefined && message.id !== null && id === null) return invalid("invalid message identity");
    if (message.role !== "assistant") { close(); continue; }
    if (current && (id === null || current.id === null)) {
      return invalid("ambiguous assistant fragments without message identity");
    }
    if (!current || current.id !== id) {
      close();
      if (id !== null && closedIds.has(id)) return invalid("message identity reused across response boundaries");
      current = { id, output: "", blocked: false };
    }
    if (!Array.isArray(message.content)) return invalid("unsupported message content");
    const types = message.content.map(value => record(value).type);
    // A tool request invalidates the entire message, including preceding text
    // fragments with the same ID. A later response must have a new identity.
    if (metadata.userVisible === false || metadata.turnContext === true || metadata.outputTokenLimitReached === true ||
        types.some(type => !["text", "thinking", "redactedThinking"].includes(String(type)))) {
      current.blocked = true;
    }
    if (!current.blocked) current.output += visibleText(message.content);
  }
  if (!current || current.blocked || !current.output.trim()) return invalid("no final visible assistant text after the last turn/tool boundary");
  return current.output;
}
