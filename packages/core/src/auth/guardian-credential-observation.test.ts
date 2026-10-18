import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { replaceStaffPasswordAndInvalidateSessions } from "./session.js";
import { replaceMemberPasswordAndInvalidateSessions } from "./member-session.js";
import { consumePasswordResetToken } from "./reset-token.js";
import { consumeMemberPasswordReset } from "./member-credentials.js";
import {
  resetGuardianSensitiveObserverV1,
  setGuardianSensitiveObserverV1,
  type NpGuardianSensitiveObserverV1,
} from "../agent/guardian-sensitive-observer.js";
vi.mock("./password.js", () => ({
  hashPassword: () => Promise.resolve("new-private-password-hash"),
}));
const id = "73111111-1111-4111-8111-111111111111";
function fixture() {
  const state = {
    password: "old-private-password-hash",
    tokenVersion: 3,
    status: "pending",
    emailVerified: false,
    sessions: 2,
    found: true,
    change: true,
  };
  const order: string[] = [],
    records: Parameters<NpGuardianSensitiveObserverV1["recordCredential"]>[0][] = [];
  const select = vi.fn(() => {
    const query = {
      from() {
        order.push("read");
        return query;
      },
      where() {
        return query;
      },
      for() {
        order.push("row-lock");
        return query;
      },
      limit: () =>
        Promise.resolve(
          state.found
            ? [
                {
                  id,
                  email: "private@example.invalid",
                  purpose: "reset",
                  tokenVersion: state.tokenVersion,
                  status: state.status,
                  emailVerified: state.emailVerified,
                },
              ]
            : [],
        ),
    };
    return query;
  });
  const db = {
    select,
    update(table: PgTable) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              return {
                returning: async () => {
                  await Promise.resolve();
                  order.push("write");
                  if (!state.change) return [];
                  state.password = String(values.password);
                  state.tokenVersion++;
                  if (getTableName(table) === "np_members" && values.emailVerified === true) {
                    state.emailVerified = true;
                    if (state.status === "pending") state.status = "active";
                  }
                  return [
                    {
                      id,
                      tokenVersion: state.tokenVersion,
                      emailVerified: state.emailVerified,
                      status: state.status,
                    },
                  ];
                },
              };
            },
          };
        },
      };
    },
    delete() {
      return {
        where: async () => {
          await Promise.resolve();
          order.push("sessions");
          state.sessions = 0;
        },
      };
    },
    transaction: async <T>(work: (tx: NodePgDatabase<Record<string, unknown>>) => Promise<T>) => {
      const before = structuredClone(state);
      try {
        return await work(db);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
  } as unknown as NodePgDatabase<Record<string, unknown>>;
  const observer: NpGuardianSensitiveObserverV1 = {
    prepare: vi.fn(() => {
      order.push("prepare");
      return Promise.resolve();
    }),
    projectState: () =>
      Promise.reject(new Error("Password capture must not project password material")),
    recordCredential: vi.fn((input) => {
      order.push("record");
      records.push(input);
      return Promise.resolve();
    }),
    recordPlugin: () => Promise.reject(new Error("Unexpected plugin transition")),
  };
  return { state, order, records, select, db, observer };
}
beforeEach(resetGuardianSensitiveObserverV1);
afterEach(resetGuardianSensitiveObserverV1);
describe("password mutation source ownership", () => {
  it("adds no source reads when absent and preserves the original password/session result", async () => {
    const f = fixture();
    expect(
      await replaceStaffPasswordAndInvalidateSessions(id, f.state.password, "changed", f.db),
    ).toBe(true);
    expect(f.select).not.toHaveBeenCalled();
    expect(f.order).toEqual(["write", "sessions"]);
    expect(f.state.sessions).toBe(0);
  });
  it.each(["staff", "member"])(
    "prepares before %s principal locks and records only persisted version facts",
    async (audience) => {
      const f = fixture();
      setGuardianSensitiveObserverV1(f.observer);
      const result =
        audience === "staff"
          ? await replaceStaffPasswordAndInvalidateSessions(id, f.state.password, "changed", f.db)
          : await replaceMemberPasswordAndInvalidateSessions(f.db, id, f.state.password, "changed");
      expect(result).toBe(true);
      expect(f.order).toEqual(["prepare", "read", "row-lock", "write", "sessions", "record"]);
      expect(f.records[0]).toMatchObject({
        db: f.db,
        scope: { kind: "deployment" },
        actor: { kind: "system" },
        transition: {
          kind: "password-replaced",
          audience,
          principalId: id,
          purpose: "password-change",
          previous: { tokenVersion: 3 },
          current: { tokenVersion: 4 },
          memberResetActivation: null,
        },
      });
      expect(JSON.stringify(f.records[0].transition)).not.toMatch(
        /password-hash|changed|private@example/u,
      );
    },
  );
  it("rolls password, version and sessions back together when the installed source fails", async () => {
    const f = fixture(),
      before = structuredClone(f.state);
    setGuardianSensitiveObserverV1({
      ...f.observer,
      recordCredential: () => Promise.reject(new Error("Injected source receipt failure")),
    });
    await expect(
      replaceStaffPasswordAndInvalidateSessions(id, f.state.password, "changed", f.db),
    ).rejects.toThrow("Injected source receipt failure");
    expect(f.state).toEqual(before);
  });
  it("does not create a source fact when password CAS affects no row", async () => {
    const f = fixture();
    f.state.change = false;
    setGuardianSensitiveObserverV1(f.observer);
    expect(
      await replaceStaffPasswordAndInvalidateSessions(id, f.state.password, "changed", f.db),
    ).toBe(false);
    expect(f.records).toEqual([]);
    expect(f.state.sessions).toBe(2);
  });
  it("records staff reset consumption as a system-owned credential fact, not an authenticated target actor", async () => {
    const f = fixture();
    setGuardianSensitiveObserverV1(f.observer);
    await consumePasswordResetToken(f.db, {
      token: "a".repeat(64),
      newPassword: "Valid-password-credential-source",
    });
    expect(f.order.indexOf("prepare")).toBeLessThan(f.order.indexOf("row-lock"));
    expect(f.records[0]).toMatchObject({
      actor: { kind: "system", component: "auth.password-reset" },
      transition: {
        kind: "password-replaced",
        audience: "staff",
        purpose: "password-reset",
        previous: { tokenVersion: 3 },
        current: { tokenVersion: 4 },
      },
    });
  });
  it.each(["pending", "suspended", "deleted", "imported"])(
    "preserves actual %s member reset effects separately from password state",
    async (status) => {
      const f = fixture();
      f.state.status = status;
      setGuardianSensitiveObserverV1(f.observer);
      await consumeMemberPasswordReset(f.db, "b".repeat(64), "Valid-password-credential-source");
      expect(f.records[0]).toMatchObject({
        actor: { kind: "system", component: "auth.member-password-reset" },
        transition: {
          kind: "password-replaced",
          audience: "member",
          purpose: "password-reset",
          previous: { tokenVersion: 3 },
          current: { tokenVersion: 4 },
          memberResetActivation: {
            previous: { emailVerified: false, status },
            current: { emailVerified: true, status: status === "pending" ? "active" : status },
          },
        },
      });
    },
  );
});
