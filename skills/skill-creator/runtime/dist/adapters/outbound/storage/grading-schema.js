const definitions = {
    grading_extension: "CREATE TABLE grading_extension(version INTEGER PRIMARY KEY CHECK(version=1))",
    grading_runs: `CREATE TABLE grading_runs(id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
 trial_id TEXT NOT NULL, created_at TEXT NOT NULL, manifest_digest TEXT NOT NULL, evidence_digest TEXT NOT NULL,
 request_digest TEXT NOT NULL, criteria_json TEXT NOT NULL, request_json TEXT NOT NULL, manifest_json TEXT NOT NULL,
 provenance_json TEXT NOT NULL, outcome_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('completed','technical-error')),
 FOREIGN KEY(campaign_id,attempt_id) REFERENCES trials(campaign_id,id))`,
    judgments: `CREATE TABLE judgments(grading_id TEXT NOT NULL REFERENCES grading_runs(id), criterion_id TEXT NOT NULL,
 criterion_text TEXT NOT NULL, verdict TEXT NOT NULL CHECK(verdict IN ('pass','fail','inconclusive')), rationale TEXT NOT NULL,
 evidence_json TEXT NOT NULL, PRIMARY KEY(grading_id,criterion_id))`,
};
const triggers = Object.fromEntries(Object.keys(definitions).flatMap(table => ["UPDATE", "DELETE"].map(operation => {
    const name = `${table}_no_${operation.toLowerCase()}`;
    return [name, `CREATE TRIGGER ${name} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Grading is append-only'); END`];
})));
const normalize = (sql) => sql.replace(/\s+/g, " ").trim();
/** Separate extension version: principal user_version remains 2. Missing, partial or
 * altered schema is never repaired. All initialization is within explicit append's transaction. */
export function validateGradingExtension(db, initialize) {
    const objects = db.query("SELECT name,type,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
    const relevant = objects.filter(row => row.name.startsWith("grading_") || row.name.startsWith("judgments") || Object.keys(definitions).includes(row.tbl_name));
    if (!relevant.length) {
        if (!initialize)
            return;
        for (const sql of Object.values(definitions))
            db.exec(sql);
        for (const sql of Object.values(triggers))
            db.exec(sql);
        db.exec("INSERT INTO grading_extension VALUES(1)");
    }
    else {
        const expected = { ...definitions, ...triggers };
        if (relevant.length !== Object.keys(expected).length)
            throw new Error("Malformed grading extension objects");
        for (const [name, sql] of Object.entries(expected)) {
            const actual = relevant.find(row => row.name === name);
            // Exact SQL authenticates columns, keys, FK targets, checks and trigger bodies,
            // not merely their names. SQLite-generated PK indexes are excluded above.
            if (!actual?.sql || normalize(actual.sql) !== normalize(sql))
                throw new Error("Malformed grading extension definition");
        }
    }
    const versions = db.query("SELECT version FROM grading_extension").all();
    if (versions.length !== 1 || versions[0]?.version !== 1 || db.query("PRAGMA foreign_key_check").all().length)
        throw new Error("Invalid grading extension version/relationships");
}
