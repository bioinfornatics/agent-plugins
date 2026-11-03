import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../src/adapters/outbound/storage/sqlite-database.ts";

test("SQLite positional rows and immediate rollback preserve values and original failure", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE items(value TEXT)");
    db.transaction(() => db.query("INSERT INTO items VALUES(?)").run("original")).immediate();
    assert.deepStrictEqual(db.query("SELECT value FROM items").all(), [{ value: "original" }]);
    assert.strictEqual(db.query("SELECT value FROM items WHERE value=?").get("missing"), null);
    const failure = new Error("callback failed");
    assert.throws(() => db.transaction(() => {
      db.query("INSERT INTO items VALUES(?)").run("rollback");
      throw failure;
    }).immediate(), (error) => error === failure);
    assert.deepStrictEqual(db.query("SELECT value FROM items").all(), [{ value: "original" }]);
  } finally { db.close(); }
});

test("SQLite refuses asynchronous transaction work and rolls back thenable results", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE items(value TEXT)");
    let executed = false;
    // Deliberately cross the TypeScript boundary to verify runtime admission too.
    const asynchronous = (async () => { executed = true; }) as unknown as () => void;
    assert.throws(() => db.transaction(asynchronous).immediate(), /synchronous callback/);
    assert.strictEqual(executed, false);
    assert.throws(() => db.transaction(() => {
      db.query("INSERT INTO items VALUES(?)").run("rollback");
      // biome-ignore lint/suspicious/noThenProperty: Exercise rejection of a malicious thenable at the runtime boundary.
      return { then: () => {} } as unknown as string;
    }).immediate(), /thenable/);
    assert.deepStrictEqual(db.query("SELECT * FROM items").all(), []);
  } finally { db.close(); }
});

test("SQLite no-create and readonly connections preserve filesystem bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "node-sqlite-contract-"));
  try {
    const path = join(root, "registry.sqlite");
    for (const options of [{ create: false }, { readonly: true }]) {
      assert.throws(() => new Database(path, options), { code: "ENOENT" });
      await assert.rejects(stat(path), { code: "ENOENT" });
    }
    const writer = new Database(path);
    writer.exec("CREATE TABLE items(value TEXT)"); writer.close();
    const before = await readFile(path);
    const reader = new Database(path, { readonly: true, create: false });
    try { assert.throws(() => reader.exec("INSERT INTO items VALUES('forbidden')"), /readonly/); }
    finally { reader.close(); }
    assert.deepStrictEqual(await readFile(path), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
