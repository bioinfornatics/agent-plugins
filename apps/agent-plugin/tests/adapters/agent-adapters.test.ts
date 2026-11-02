import { expect, test } from "bun:test";
import { GooseAdapter } from "../../src/adapters/outbound/agents/goose-adapter.ts";
import { CodexAdapter } from "../../src/adapters/outbound/agents/codex-adapter.ts";
import { ClaudeAdapter } from "../../src/adapters/outbound/agents/claude-adapter.ts";
import { ExecuteAgentUseCase } from "../../src/application/use-cases/execute-agent.ts";

for (const Adapter of [GooseAdapter, CodexAdapter, ClaudeAdapter]) {
  test(`${Adapter.name} forwards the prompt and normalizes the client result`, async () => {
    const prompts: string[] = [];
    const adapter = new Adapter({ complete: async (prompt) => { prompts.push(prompt); return "A generated skill"; } });
    const result = await new ExecuteAgentUseCase([adapter]).execute({ agent: adapter.id, prompt: "  Create a skill\n" });
    expect(prompts).toEqual(["  Create a skill\n"]);
    expect(result).toEqual({ agent: adapter.id, text: "A generated skill" });
  });

  test(`${Adapter.name} preserves client failure instead of reporting success`, async () => {
    const failure = new Error("Client failed");
    const adapter = new Adapter({ complete: async () => { throw failure; } });
    await expect(adapter.execute({ prompt: "hello" })).rejects.toBe(failure);
  });
}
