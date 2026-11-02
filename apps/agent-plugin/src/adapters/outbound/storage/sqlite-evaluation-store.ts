import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { EvaluationPlan, EvaluationStore } from "../../../application/ports/evaluation-store.ts";
import type { TrialRequest, TrialResult } from "../../../domain/execution.ts";

/** SQLite indexes host-supplied evidence; the host owns redaction and exclusion of private auth files.
 * Exclusive writes avoid overwrite; hashes record persisted bytes, not filesystem immutability.
 */
export class SqliteEvaluationStore implements EvaluationStore {
  private db?: Database;
  private output?: string;
  constructor(private readonly destination: string) {}
  async begin(plan: EvaluationPlan) {
    const id = randomUUID();
    const output = join(resolve(this.destination), id);
    await mkdir(output, { recursive: true, mode: 0o700 });
    await chmod(output, 0o700);
    const dbPath = join(output, "evaluation.sqlite");
    const db = new Database(dbPath, { create: true });
    this.db = db; this.output = output;
    await chmod(dbPath, 0o600);
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE experiments(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, plan_json TEXT NOT NULL, method TEXT NOT NULL);
      CREATE TABLE trials(id TEXT PRIMARY KEY, pair_id TEXT NOT NULL, condition TEXT NOT NULL, scenario TEXT NOT NULL, target TEXT NOT NULL,
        status TEXT NOT NULL, collection TEXT NOT NULL, receipt_json TEXT);
      CREATE TABLE artifacts(trial_id TEXT NOT NULL REFERENCES trials(id), path TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(trial_id,path));`);
    db.query("INSERT INTO experiments VALUES(?,?,?,?)").run(id, new Date().toISOString(), JSON.stringify(plan), "paired-sequential-v1");
    return { id, output };
  }
  async start(request: TrialRequest) {
    this.database().query("INSERT INTO trials VALUES(?,?,?,?,?,?,?,?)").run(request.id, request.pairId, request.condition,
      request.scenario.id, request.target.root, "running", "unavailable", null);
  }
  async finish(request: TrialRequest, result: TrialResult) {
    const root = this.output;
    if (!root) throw new Error("Store not initialized");
    // Stage all bytes and the manifest before publishing the tree, then index them in one SQLite transaction.
    // Filesystem + SQLite are not atomic: failure after rename can leave unindexed evidence; no recovery here.
    const pending = join(root, `${request.id}.pending`);
    const final = join(root, "artifacts", request.id);
    await mkdir(pending, { mode: 0o700 });
    const manifest: { path: string; sha256: string; bytes: number }[] = [];
    for (const artifact of result.artifacts) {
      if (isAbsolute(artifact.path) || artifact.path.includes("\\") || artifact.path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Unsafe artifact path");
      const path = join(pending, artifact.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, artifact.content, { flag: "wx", mode: 0o600 });
      manifest.push({ path: artifact.path, sha256: createHash("sha256").update(artifact.content).digest("hex"), bytes: artifact.content.length });
    }
    await writeFile(join(pending, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
    await mkdir(dirname(final), { recursive: true, mode: 0o700 });
    await rename(pending, final);
    const { artifacts: _artifacts, ...receipt } = result;
    const db = this.database();
    db.transaction(() => {
      for (const artifact of manifest) db.query("INSERT INTO artifacts VALUES(?,?,?,?)").run(request.id, artifact.path, artifact.sha256, artifact.bytes);
      db.query("UPDATE trials SET status=?, collection=?, receipt_json=? WHERE id=?").run(result.status, result.collection, JSON.stringify(receipt), request.id);
    })();
  }
  async fail(request: TrialRequest) {
    this.database().query("UPDATE trials SET status='unavailable',collection='unavailable',receipt_json=? WHERE id=?")
      .run(JSON.stringify({ error: "Host preparation or launch failed; raw diagnostic withheld to avoid exposing credentials" }), request.id);
  }
  async close() { this.db?.close(); this.db = undefined; }
  private database() { if (!this.db) throw new Error("Store not initialized"); return this.db; }
}
