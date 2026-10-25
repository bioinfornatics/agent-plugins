#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("fake-current-goose 1.47.0"); process.exit(0); }
for await (const _chunk of process.stdin) { /* consume instructions */ }
console.log(JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "current host " }] } }));
console.log(JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "response" }] } }));
console.log(JSON.stringify({ type: "complete", total_tokens: 23, input_tokens: 17, output_tokens: 6 }));
