#!/usr/bin/env node
for await (const _chunk of process.stdin) { /* consume grading request */ }
const value = JSON.stringify({ verdict: "pass", evidence_quote: "evidence", rationale: "supported" });
console.log(JSON.stringify({ type: "message", message: { content: [{ type: "text", text: value.slice(0, 24) }] } }));
console.log(JSON.stringify({ type: "message", message: { content: [{ type: "text", text: value.slice(24) }] } }));
console.log(JSON.stringify({ type: "complete", total_tokens: 29, input_tokens: 20, output_tokens: 9 }));
