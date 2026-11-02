import { expect, test } from "bun:test";
import { main } from "../../src/main.ts";

test("evaluation exposes combinable targets and native limit options", async () => {
  let out = "", err = "";
  const code = await main(["evaluation", "--help"], {
    writeOut: (s) => { out += s; }, writeErr: (s) => { err += s; },
  });
  expect(code).toBe(0);
  expect(err).toBe("");
  for (const option of ["--skills", "--plugin", "--model", "--repetitions", "--max-turns"]) expect(out).toContain(option);
  expect(out).not.toContain("--budget");
});

test("evaluation requires a target instead of reporting empty success", async () => {
  let out = "", err = "";
  const code = await main(["evaluation"], {
    writeOut: (s) => { out += s; }, writeErr: (s) => { err += s; },
  });
  expect(code).toBe(1);
  expect(out).toBe("");
  expect(err).toContain("--skills or --plugin");
});
