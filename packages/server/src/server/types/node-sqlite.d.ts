/**
 * Minimal typings for `node:sqlite`.
 *
 * The daemon runs on Node 22, where this module exists, but the server package
 * types against `@types/node@^20`, which predates it. Bumping that shared dev
 * dependency would create a merge conflict surface on every upstream sync for
 * the sake of one module, so the surface we actually use is declared here
 * instead. Delete this file once `@types/node` ships these typings.
 */
declare module "node:sqlite" {
  type SQLiteValue = string | number | bigint | null | Uint8Array;

  export class StatementSync {
    run(...params: SQLiteValue[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: SQLiteValue[]): unknown;
    all(...params: SQLiteValue[]): unknown[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
