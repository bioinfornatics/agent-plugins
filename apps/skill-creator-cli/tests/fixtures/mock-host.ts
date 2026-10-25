import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Imported mock runners do not use the operator's profile-only transport. */
export function isolateMockTransport(): void {
  const keys = ["GOOSE_PROVIDER", "GOOSE_MODEL"];
  let prior: Record<string, string | undefined>;
  test.before(() => {
    prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    process.env.GOOSE_PROVIDER = "ollama";
    process.env.GOOSE_MODEL = "no-provider-fixture";
  });
  test.after(() => {
    for (const key of keys) prior[key] === undefined ? delete process.env[key] : process.env[key] = prior[key];
  });
}

/** Fixture controls travel as explicit argv, not isolated environment passthrough. */
export function fakeGooseCommand(root: string, controls: Record<string, string | undefined> = {}): string {
  const config = join(root, "mock-host-config.json"), wrapper = join(root, "mock-host.mjs");
  writeFileSync(config, JSON.stringify(controls));
  writeFileSync(wrapper, 'import { readFileSync } from "node:fs";Object.assign(process.env,JSON.parse(readFileSync(process.argv[2],"utf8")));await import(' + JSON.stringify(new URL("fake-goose.mjs", import.meta.url).href) + ');');
  const quote = (value: string) => "'" + value.replaceAll("'", "'\''") + "'";
  return [process.execPath, wrapper, config].map(quote).join(" ");
}
