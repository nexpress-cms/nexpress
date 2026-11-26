import type { getDb } from "../db/runtime.js";

type Db = ReturnType<typeof getDb>;

export interface NpAgentGuardianTransactionScopeOptionsV1 {
  checkpoint(): void;
  unavailable(): never;
  closed(): never;
}

/** Drizzle does not close a pooled transaction object after rollback. Guard the
 * exact client used by builders, prepared queries and nested savepoints without
 * changing pg's Promise, callback or submittable-query calling conventions.
 * The original raw outer transaction alone owns commit/rollback/pool release. */
export function npCreateAgentGuardianTransactionScopeV1(
  db: Db,
  options: NpAgentGuardianTransactionScopeOptionsV1,
): { db: Db; close(): void } {
  const session: unknown = Reflect.get(db, "session");
  if (!session || typeof session !== "object") options.unavailable();
  const client: unknown = Reflect.get(session, "client");
  if (!client || typeof client !== "object" || typeof Reflect.get(client, "query") !== "function")
    options.unavailable();
  let live = true;
  const check = () => {
    if (!live) options.closed();
    options.checkpoint();
  };
  const guardedClient = new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (property === "query") check();
        const result: unknown = Reflect.apply(value, target, args);
        return result;
      };
    },
  });
  const guardedSession = new Proxy(session, {
    get(target, property, receiver) {
      const value: unknown =
        property === "client" ? guardedClient : Reflect.get(target, property, receiver);
      return value;
    },
  });
  return {
    db: new Proxy(db, {
      get(target, property, receiver) {
        const value: unknown =
          property === "session"
            ? guardedSession
            : property === "$client"
              ? guardedClient
              : Reflect.get(target, property, receiver);
        return value;
      },
    }),
    close() {
      live = false;
    },
  };
}
