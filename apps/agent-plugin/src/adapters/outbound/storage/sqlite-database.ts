import { statSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync, SQLInputValue, StatementResultingChanges } from "node:sqlite";

interface DatabaseOptions {
  create?: boolean;
  readwrite?: boolean;
  readonly?: boolean;
}

/** Storage-local positional statement contract; rows are ordinary objects, not Node's
 * null-prototype records, so callers retain the previous SQLite adapter's row semantics.
 */
interface Query<Row, Params extends SQLInputValue[]> {
  get(...params: Params): Row | null;
  all(...params: Params): Row[];
  run(...params: Params): StatementResultingChanges;
}

/** Concrete synchronous SQLite boundary, limited to the operations used by registry storage. */
export class Database {
  private readonly connection: DatabaseSync;

  constructor(path: string, options: DatabaseOptions = {}) {
    if (options.readonly && options.readwrite) throw new Error("SQLite cannot be both readonly and readwrite");
    if (path !== ":memory:" && (options.create === false || options.readonly)) {
      // DatabaseSync has no SQLITE_OPEN_READWRITE-without-CREATE option. Require an
      // existing regular file; private ownership/link checks remain in registry-files.
      // Like that preparation, this cannot eliminate concurrent path replacement.
      if (!statSync(path).isFile()) throw new Error("SQLite requires an existing regular file");
    }
    // Loading this experimental builtin emits a warning on Node 22. Defer it until
    // storage is actually opened: import-only/help/dry-run paths must remain silent.
    const { DatabaseSync: Connection } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    this.connection = new Connection(path, { readOnly: options.readonly ?? false });
  }

  exec(sql: string): void {
    this.connection.exec(sql);
  }

  query<Row = Record<string, unknown>, Params extends SQLInputValue[] = SQLInputValue[]>(sql: string): Query<Row, Params> {
    const statement = this.connection.prepare(sql);
    return {
      get: (...params: Params): Row | null => {
        const row = statement.get(...params);
        return row === undefined ? null : { ...row } as Row;
      },
      all: (...params: Params): Row[] => statement.all(...params).map(row => ({ ...row } as Row)),
      run: (...params: Params): StatementResultingChanges => statement.run(...params),
    };
  }

  /** Only synchronous callbacks are accepted. Async work could outlive rollback and
   * write outside the transaction; reject async functions before they run and thenables
   * before commit. Transactions are not nested; SQLite rejects a second BEGIN.
   */
  transaction<Result>(operation: (() => Result) & ([Result] extends [never] ? unknown : [Result] extends [PromiseLike<unknown>] ? never : unknown)): { immediate(): Result } {
    return {
      immediate: (): Result => {
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
        } catch (error) {
          // A callback or failed commit is the primary failure, even if rollback
          // also fails (for example, the callback already closed the connection).
          try { this.connection.exec("ROLLBACK"); } catch { /* Preserve the original error. */ }
          throw error;
        }
      },
    };
  }

  close(): void {
    this.connection.close();
  }
}
