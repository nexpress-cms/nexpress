import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text } from "drizzle-orm/pg-core";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { npCreateAgentGuardianTransactionScopeV1 } from "./guardian-transaction-scope.js";

const table = pgTable("guardian_scope_unit", { id: text("id").notNull() });
function fixture() {
  const client = new pg.Client();
  const result = { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
  const query = vi.fn(function (this: object, ...args: unknown[]) {
    expect(this).toBe(client);
    const config = args[0];
    if (config && typeof config === "object" && typeof Reflect.get(config, "submit") === "function")
      return config;
    const callback = args.find((argument) => typeof argument === "function");
    if (typeof callback === "function") {
      Reflect.apply(callback, undefined, [null, result]);
      return undefined;
    }
    return Promise.resolve(result);
  });
  if (!Reflect.set(client, "query", query)) throw new Error("Expected a controllable unit driver");
  const db = drizzle<Record<string, unknown>, pg.Client>(client);
  const closed = new Error("closed source transaction");
  const expired = new Error("expired source transaction");
  const unavailable = new Error("unsupported source transaction");
  const state = { expired: false };
  const options = {
    checkpoint() {
      if (state.expired) throw expired;
    },
    unavailable(): never {
      throw unavailable;
    },
    closed(): never {
      throw closed;
    },
  };
  const scope = npCreateAgentGuardianTransactionScopeV1(db, options);
  const guarded: unknown = Reflect.get(scope.db, "$client");
  if (!guarded || typeof guarded !== "object") throw new Error("Expected guarded driver");
  const queryMethod: unknown = Reflect.get(guarded, "query");
  if (typeof queryMethod !== "function") throw new Error("Expected guarded query method");
  const invoke = (...args: unknown[]) => Reflect.apply(queryMethod, guarded, args);
  return { client, db, query, result, scope, state, options, closed, expired, unavailable, invoke };
}

describe("Guardian transaction liveness scope", () => {
  it("preserves exact Promise, callback and submittable query returns without changing arguments", async () => {
    const f = fixture();
    const config = { text: "select $1", rowMode: "array" };
    const pending = Promise.resolve(f.result);
    f.query.mockImplementationOnce(() => pending);
    expect(f.invoke(config, [1])).toBe(pending);
    await pending;
    expect(f.query).toHaveBeenLastCalledWith(config, [1]);
    const callback = vi.fn();
    expect(f.invoke("select $1", [2], callback)).toBeUndefined();
    expect(callback).toHaveBeenCalledExactlyOnceWith(null, f.result);
    expect(f.query).toHaveBeenLastCalledWith("select $1", [2], callback);
    const submitted = { submit: vi.fn() };
    expect(f.invoke(submitted)).toBe(submitted);
    expect(f.query).toHaveBeenLastCalledWith(submitted);
  });

  it("rejects a saved prepared builder and direct query after closure before reaching the driver", async () => {
    const f = fixture();
    const saved = f.scope.db.select().from(table).prepare("guardian_scope_saved");
    f.scope.close();
    await expect(saved.execute()).rejects.toThrow();
    expect(() => f.invoke("select 1")).toThrow(f.closed);
    expect(f.query).not.toHaveBeenCalled();
  });

  it("checks elapsed work before dispatch and fails closed on unsupported transaction shape", async () => {
    const f = fixture();
    f.state.expired = true;
    await expect(f.scope.db.execute(sql`select 1`)).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
    const missingSession = new Proxy(f.db, {
      get(target, property, receiver) {
        return property === "session" ? null : Reflect.get(target, property, receiver);
      },
    });
    expect(() => npCreateAgentGuardianTransactionScopeV1(missingSession, f.options)).toThrow(
      f.unavailable,
    );
  });

  it("guards nested savepoint builders while the raw outer driver retains commit ownership", async () => {
    const f = fixture();
    const late: Array<() => Promise<unknown>> = [];
    await f.db.transaction(async (raw) => {
      const scope = npCreateAgentGuardianTransactionScopeV1(raw, f.options);
      try {
        await scope.db.transaction(async (child) => {
          const saved = child.select().from(table).prepare("guardian_scope_nested");
          late.push(() => saved.execute());
          await child.execute(sql`select 1`);
        });
      } finally {
        scope.close();
      }
    });
    const calls = f.query.mock.calls.length;
    expect(
      f.query.mock.calls.some(
        ([config]) =>
          config === "commit" ||
          (config !== null &&
            typeof config === "object" &&
            Reflect.get(config, "text") === "commit"),
      ),
    ).toBe(true);
    if (late.length !== 1) throw new Error("Expected one nested prepared query");
    await expect(late[0]()).rejects.toThrow();
    expect(f.query).toHaveBeenCalledTimes(calls);
  });
});
