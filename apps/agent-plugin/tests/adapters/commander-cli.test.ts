import { expect, test } from "bun:test";
import { bootstrap } from "../../src/bootstrap.ts";

test("Commander dispatches to the selected client and renders its result", async () => {
  let stdout = "";
  let stderr = "";
  const prompts: string[] = [];
  const program = bootstrap({
    writeOut: (text) => { stdout += text; },
    writeErr: (text) => { stderr += text; },
  }, {
    codex: { complete: async (prompt) => { prompts.push(prompt); return "Skill content"; } },
    goose: { complete: async () => { throw new Error("Wrong adapter selected"); } },
    claude: { complete: async () => { throw new Error("Wrong adapter selected"); } },
  });
  await program.parseAsync(["run", "--agent", "codex", "--prompt", "Create a skill"], { from: "user" });
  expect(prompts).toEqual(["Create a skill"]);
  expect(stdout).toBe("Skill content\n");
  expect(stderr).toBe("");
});
