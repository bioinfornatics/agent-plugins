import assert from "node:assert/strict";
import { test } from "node:test";
import { GooseActivationObserver, observeGooseActivation } from "../../src/adapters/outbound/hosts/goose/goose-activation.ts";
import { classifyActivation } from "../../src/domain/activation.ts";
import type { ActivationTreatment } from "../../src/application/ports/activation-observer.ts";

// Synthetic transcripts follow Goose 1.57.0 export shapes observed in local campaigns:
// toolRequest {id, toolCall:{status,value:{name,arguments}}} / toolResponse {id, toolResult:{status,value:{content,isError}}}.
const CYCLE_LINE = "Coordinate the evidence-driven cycle before any phase delegation happens.";
const SHARED_LINE = "| Intent / condition | Execute | Required result for every phase |";
const skillMd = (name: string, line: string) => `---\nname: ${name}\ndescription: Shared catalog description visible to every host listing.\n---\n\n# Title\n\n${SHARED_LINE}\n${line}\n`;
const standalone: ActivationTreatment = { components: [
  { kind: "skill", installationName: "cycle", skillFiles: [{ path: "SKILL.md", content: skillMd("cycle", CYCLE_LINE) }] },
  { kind: "skill", installationName: "implement", skillFiles: [{ path: "SKILL.md", content: skillMd("implement", "Implement only the authorized change and keep the preserved-work ledger.") }] },
] };
const plugin: ActivationTreatment = { components: [{ kind: "plugin", installationName: "dev", skillFiles: [{ path: "skills/cycle/SKILL.md", content: skillMd("cycle", CYCLE_LINE) }] }] };

let next = 0;
function call(name: string, args: unknown, text: string, isError = false) {
  const id = `call-${++next}`;
  return [
    { role: "assistant", content: [{ type: "toolRequest", id, toolCall: { status: "success", value: { name, arguments: args } } }] },
    { role: "user", content: [{ type: "toolResponse", id, toolResult: { status: "success", value: { content: [{ type: "text", text }], isError } } }] },
  ];
}
const classify = (condition: "with" | "without", messages: unknown[], treatment = standalone) => classifyActivation(condition, observeGooseActivation(messages, treatment));
const loaded = (name: string) => `# Loaded Skill: ${name} (skill)\n\n## Content\n\n${CYCLE_LINE}`;
const headerOnly = (name: string) => `# Loaded Skill: ${name} (skill)`;
const notFound = (name: string) => `Error: Error: Tool load_skill failed: "Skill '${name}' not found." (native)`;

test("host-confirmed load_skill result, not an assistant claim, establishes triggered; a later success supersedes a failure", () => {
  assert.equal(classify("with", [{ role: "assistant", content: [{ type: "text", text: "I loaded the cycle Skill." }] }]), "not-triggered");
  assert.equal(classify("with", call("load_skill", { name: "cycle" }, notFound("cycle"), true)), "attempted-failed");
  const both = [...call("load_skill", { name: "cycle" }, notFound("cycle"), true), ...call("load_skill", { name: "cycle" }, loaded("cycle"))];
  assert.deepEqual(observeGooseActivation(both, standalone).loaded, ["cycle"]);
  assert.deepEqual(observeGooseActivation(both, standalone).failedLoads, []);
  assert.equal(classifyActivation("with", observeGooseActivation(both, standalone)), "triggered");
});

test("code-mode wrappers attribute JSON-escaped host headers but not code containing literal header text", () => {
  const escaped = `Result: ${JSON.stringify([loaded("cycle"), "# Loaded Skill: goose-doc-guide (builtin skill)"])}`;
  assert.equal(classify("with", call("execute_javascript", { code: "return Promise.all(['cycle','goose-doc-guide'].map(name => tools.call('load_skill',{name})))" }, escaped)), "triggered");
  assert.equal(classify("with", call("execute_javascript", { code: "console.log('# Loaded Skill: cycle (skill)'); tools.call('load_skill',{name:'cycle'})" }, headerOnly("cycle"))), "inconclusive");
  // Profile body delivered by such a wrapper is still consumed content, never a confirmed trigger.
  assert.equal(classify("with", call("execute_javascript", { code: "console.log('# Loaded Skill: cycle (skill)'); tools.call('load_skill',{name:'cycle'})" }, loaded("cycle"))), "direct-read");
  // A wrapper that loads an unrelated Skill and also reads profile content contaminates a baseline.
  assert.equal(classify("without", call("execute_javascript", { code: "await tools.call('load_skill',{name:'goose-doc-guide'}); console.log(await tools.call('shell',{command:'cat ~/.agents/skills/cycle/SKILL.md'}))" }, `# Loaded Skill: goose-doc-guide (builtin skill)\n${CYCLE_LINE}`)), "baseline-contaminated");
  // Unrelated builtin loads neither trigger nor make the profile verdict inconclusive.
  assert.equal(classify("with", call("execute_javascript", { code: "await tools.call('load_skill',{name:'goose-doc-guide'})" }, "Result: undefined")), "not-triggered");
  assert.equal(classify("with", call("execute_javascript", { code: "await tools.call('load_skill',{name:'cycle'})" }, "Result: undefined")), "inconclusive");
});

test("Plugin children resolve only under their namespaced Goose name; an unqualified success stays unattributed", () => {
  assert.equal(classify("with", call("load_skill", { name: "dev:cycle" }, loaded("dev:cycle")), plugin), "triggered");
  assert.equal(classify("with", call("load_skill", { name: "cycle" }, headerOnly("cycle")), plugin), "inconclusive");
  assert.equal(classify("with", call("load_skill", { name: "cycle" }, loaded("cycle")), plugin), "direct-read");
  assert.equal(classify("with", call("load", { source: "cycle" }, "Error: Source 'cycle' not found. Use load() to see available sources.", true), plugin), "attempted-failed");
});

test("baseline contamination requires a unique frozen SKILL.md body line in a tool response, whatever path served it", () => {
  const found = call("shell", { command: "find / -name SKILL.md | head; cat /home/operator/.agents/skills/cycle/SKILL.md" }, `/dev/shm/copy/skills/cycle/SKILL.md\n---\n${CYCLE_LINE}\n`);
  assert.equal(classify("without", found), "baseline-contaminated");
  assert.deepEqual(observeGooseActivation(found, standalone).fileReads, ["cycle"]);
  // Shared table rows and catalog descriptions cannot attribute a read to one profile Skill.
  assert.equal(classify("without", call("shell", { command: "grep -r Intent ." }, `${SHARED_LINE}\nShared catalog description visible to every host listing.`)), "baseline-clean");
  assert.equal(classify("without", call("shell", { command: "cat skills/cycle/SKILL.md" }, "cat: skills/cycle/SKILL.md: No such file", true)), "baseline-probe");
  assert.equal(classify("without", call("load_skill", { name: "cycle" }, notFound("cycle"), true)), "baseline-probe");
  // Path segments are matched whole: another Skill directory ending in the same letters is no probe.
  assert.equal(classify("without", call("shell", { command: "cat ~/.agents/skills/lifecycle/SKILL.md" }, "cat: missing", true)), "baseline-clean");
  assert.equal(classify("with", found), "direct-read");
});

test("duplicate or orphan tool identifiers never establish access, and unreadable evidence cannot prove absence", () => {
  const [request, response] = call("load_skill", { name: "cycle" }, loaded("cycle"));
  // Ambiguous identifiers carrying profile content are inconclusive, never a positive clean/absent label.
  assert.equal(classify("with", [request, request, response]), "inconclusive");
  assert.equal(classify("without", [request, response, response]), "inconclusive");
  assert.equal(classify("without", [response]), "inconclusive");
  const [, unrelated] = call("shell", { command: "ls" }, "README.md");
  assert.equal(classify("without", [unrelated]), "baseline-clean");
  // A profile-targeted loader call that never got a response cannot prove absence.
  assert.equal(classify("without", [request]), "inconclusive");
  assert.equal(classify("with", [call("load_skill", { name: "goose-doc-guide" }, "")[0]]), "not-triggered");
  const observer = new GooseActivationObserver();
  assert.equal(observer.observe({ agent: "goose", condition: "with", treatment: standalone, artifacts: [] })?.class, "inconclusive");
  assert.equal(observer.observe({ agent: "goose", condition: "without", treatment: standalone, artifacts: [{ path: "goose/conversation.json", content: Buffer.from("{not json") }] })?.class, "inconclusive");
  assert.equal(observer.observe({ agent: "claude", condition: "with", treatment: standalone, artifacts: [] }), undefined);
  const conversation = Buffer.from(JSON.stringify({ conversation: { messages: call("load_skill", { name: "cycle" }, loaded("cycle")) } }));
  assert.equal(observer.observe({ agent: "goose", condition: "with", treatment: standalone, artifacts: [{ path: "goose/conversation.json", content: conversation }] })?.class, "triggered");
});

test("one matching body line out of several is not enough to call a baseline contaminated", () => {
  const first = "Run the repository verification command before every handoff report.";
  const second = "Escalate scope expansions to the coordinator with the exact conflicting paths.";
  const treatment: ActivationTreatment = { components: [{ kind: "skill", installationName: "review", skillFiles: [{ path: "SKILL.md", content: skillMd("review", `${first}\n${second}`) }] }] };
  // A generic sentence copied into AGENTS.md or an input file must not prove a Skill read.
  assert.equal(classify("without", call("shell", { command: "cat AGENTS.md" }, `${first}\n`), treatment), "baseline-clean");
  assert.equal(classify("without", call("shell", { command: "cat /tmp/copy/SKILL.md" }, `${first}\n${second}\n`), treatment), "baseline-contaminated");
});
