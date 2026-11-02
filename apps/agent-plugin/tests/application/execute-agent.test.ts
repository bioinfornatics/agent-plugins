import { expect, test } from "bun:test";
import { ExecuteAgentUseCase } from "../../src/application/use-cases/execute-agent.ts";
import type { AgentGateway } from "../../src/application/ports/agent-gateway.ts";

const gateway: AgentGateway = {
  id: "goose",
  execute: async () => ({ agent: "goose", text: "result" }),
};

test("blank prompts fail before contacting a gateway", async () => {
  let contacted = false;
  const useCase = new ExecuteAgentUseCase([{
    ...gateway,
    execute: async () => { contacted = true; return { agent: "goose", text: "result" }; },
  }]);
  await expect(useCase.execute({ agent: "goose", prompt: " \n" })).rejects.toThrow("Prompt must not be empty");
  expect(contacted).toBe(false);
});

test("missing and duplicate registrations are rejected", async () => {
  expect(() => new ExecuteAgentUseCase([gateway, gateway])).toThrow("Duplicate agent 'goose'");
  await expect(new ExecuteAgentUseCase([]).execute({ agent: "goose", prompt: "hello" }))
    .rejects.toThrow("Agent 'goose' is not registered");
});

test.each([
  [{ agent: "goose" as const, text: " \n" }, "Agent returned an empty response"],
  [{ agent: "codex" as const, text: "result" }, "Agent response identity mismatch"],
])("invalid gateway result is rejected: %j", async (result, message) => {
  const useCase = new ExecuteAgentUseCase([{ id: "goose", execute: async () => result }]);
  await expect(useCase.execute({ agent: "goose", prompt: "hello" })).rejects.toThrow(message);
});
