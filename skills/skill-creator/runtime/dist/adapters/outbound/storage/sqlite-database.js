import { statSync } from "node:fs";
import { createRequire } from "node:module";
/** Concrete synchronous SQLite boundary, limited to the operations used by registry storage. */
export class Database {
    connection;
    constructor(path, options = {}) {
        if (options.readonly && options.readwrite)
            throw new Error("SQLite cannot be both readonly and readwrite");
        if (path !== ":memory:" && (options.create === false || options.readonly)) {
            // DatabaseSync has no SQLITE_OPEN_READWRITE-without-CREATE option. Require an
            // existing regular file; private ownership/link checks remain in registry-files.
            // Like that preparation, this cannot eliminate concurrent path replacement.
            if (!statSync(path).isFile())
                throw new Error("SQLite requires an existing regular file");
        }
        // Loading this experimental builtin emits a warning on Node 22. Defer it until
        // storage is actually opened: import-only/help/dry-run paths must remain silent.
        const { DatabaseSync: Connection } = createRequire(import.meta.url)("node:sqlite");
        this.connection = new Connection(path, { readOnly: options.readonly ?? false });
    }
    exec(sql) {
        this.connection.exec(sql);
    }
    query(sql) {
        const statement = this.connection.prepare(sql);
        return {
            get: (...params) => {
                const row = statement.get(...params);
                return row === undefined ? null : { ...row };
            },
            all: (...params) => statement.all(...params).map(row => ({ ...row })),
            run: (...params) => statement.run(...params),
        };
    }
    /** Only synchronous callbacks are accepted. Async work could outlive rollback and
     * write outside the transaction; reject async functions before they run and thenables
     * before commit. Transactions are not nested; SQLite rejects a second BEGIN.
     */
    transaction(operation) {
        return {
            immediate: () => {
                if (Object.prototype.toString.call(operation) === "[object AsyncFunction]") {
                    throw new TypeError("SQLite transactions require a synchronous callback");
                }
                this.connection.exec("BEGIN IMMEDIATE");
                try {
                    const result = operation();
                    if (result !== null && (typeof result === "object" || typeof result === "function") && "then" in result && typeof result.then === "function") {
                        throw new TypeError("SQLite transactions must not return a thenable");
                    }
                    this.connection.exec("COMMIT");
                    return result;
                }
                catch (error) {
                    // A callback or failed commit is the primary failure, even if rollback
                    // also fails (for example, the callback already closed the connection).
                    try {
                        this.connection.exec("ROLLBACK");
                    }
                    catch { /* Preserve the original error. */ }
                    throw error;
                }
            },
        };
    }
    close() {
        this.connection.close();
    }
}
