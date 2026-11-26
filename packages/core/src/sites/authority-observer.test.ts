import { afterEach, describe, expect, it, vi } from "vitest";
import { getTableName, type Table } from "drizzle-orm";

import { setDb, resetDb, type getDb } from "../db/runtime.js";
import { grantSiteMembership, revokeSiteMembership, setSuperAdmin } from "./memberships.js";
import {
  npGetSiteAuthorityObserverV1,
  resetSiteAuthorityObserverV1,
  setSiteAuthorityObserverV1,
  type NpSiteAuthorityObservationV1,
} from "./authority-observer.js";

const userId = "10000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000002";
const membership = {
  siteId: "tenant-a",
  userId,
  role: "editor" as const,
  createdAt: new Date("2026-10-18T00:00:00.000Z"),
  updatedAt: new Date("2026-10-18T00:00:00.000Z"),
};

function database(
  reads: unknown[][],
  inserted: unknown[] = [membership],
  mutated: { deleted: unknown[]; updated: unknown[] } = {
    deleted: [membership],
    updated: [{ isSuperAdmin: true }],
  },
) {
  const calls: string[] = [];
  const results = [...reads];
  function query(result: unknown[]) {
    const pending = Promise.resolve(result);
    const chain = {
      from(table: Table) {
        calls.push(`read:${getTableName(table)}`);
        return chain;
      },
      where: () => chain,
      orderBy: () => chain,
      for: () => chain,
      limit: () => chain,
      values: () => chain,
      set: () => chain,
      onConflictDoUpdate: () => chain,
      returning: () => chain,
      then: pending.then.bind(pending),
    };
    return chain;
  }
  const transaction = {
    select: vi.fn(() => {
      const result = results.shift();
      if (!result) throw new Error("Unexpected source read");
      return query(result);
    }),
    insert: vi.fn((table: Table) => {
      calls.push(`insert:${getTableName(table)}`);
      return query(inserted);
    }),
    delete: vi.fn((table: Table) => {
      calls.push(`delete:${getTableName(table)}`);
      return query(mutated.deleted);
    }),
    update: vi.fn((table: Table) => {
      calls.push(`update:${getTableName(table)}`);
      return query(mutated.updated);
    }),
  };
  const tx = transaction as unknown as ReturnType<typeof getDb>;
  const db = {
    transaction: vi.fn(async (run: (current: typeof tx) => Promise<unknown>) => {
      try {
        const result = await run(tx);
        calls.push("commit");
        return result;
      } catch (error) {
        calls.push("rollback");
        throw error;
      }
    }),
  } as unknown as ReturnType<typeof getDb>;
  setDb(db);
  return { tx, transaction, calls };
}

function install(calls: string[]) {
  const observations: NpSiteAuthorityObservationV1[] = [];
  const prepare = vi.fn(() => {
    calls.push("prepare");
    return Promise.resolve();
  });
  const record = vi.fn((observation: NpSiteAuthorityObservationV1) => {
    calls.push("record");
    observations.push(observation);
    return Promise.resolve();
  });
  setSiteAuthorityObserverV1({ prepare, record });
  return { prepare, record, observations };
}

afterEach(() => {
  resetSiteAuthorityObserverV1();
  resetDb();
});

describe("transactional site authority source", () => {
  it("does no extra source reads or writes when absent", async () => {
    const f = database([[], [{ id: "tenant-a" }], [{ id: userId }], []]);
    await expect(grantSiteMembership("tenant-a", userId, "editor")).resolves.toEqual(membership);
    expect(f.transaction.select).toHaveBeenCalledTimes(4);
    expect(f.calls).toEqual([
      "read:np_agent_principals",
      "read:np_sites",
      "read:np_users",
      "read:np_site_memberships",
      "insert:np_site_memberships",
      "commit",
    ]);
  });

  it("prepares before domain locks and records the persisted grant before commit", async () => {
    const f = database([[], [{ id: "tenant-a" }], [{ id: userId }], []]);
    const source = install(f.calls);
    await grantSiteMembership("tenant-a", userId, "editor", {
      actor: { kind: "staff", userId: actorId },
    });
    expect(source.prepare).toHaveBeenCalledWith({
      db: f.tx,
      scope: { kind: "site", siteId: "tenant-a" },
    });
    expect(source.observations[0]).toMatchObject({
      db: f.tx,
      scope: { kind: "site", siteId: "tenant-a" },
      actor: { kind: "staff", userId: actorId },
      transition: { kind: "site-role", userId, previousRole: null, currentRole: "editor" },
    });
    expect(source.observations[0].transitionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(source.observations[0].occurredAt).toBeInstanceOf(Date);
    expect(f.calls[0]).toBe("prepare");
    expect(f.calls.slice(-3)).toEqual(["insert:np_site_memberships", "record", "commit"]);
  });

  it("records a locked previous role and explicit default system actor on replacement", async () => {
    const f = database([
      [],
      [{ id: "tenant-a" }],
      [{ id: userId }],
      [{ ...membership, role: "author" }],
    ]);
    const source = install(f.calls);
    await grantSiteMembership("tenant-a", userId, "editor");
    expect(source.observations[0]).toMatchObject({
      actor: { kind: "system", component: "sites.memberships" },
      transition: { kind: "site-role", userId, previousRole: "author", currentRole: "editor" },
    });
  });

  it("records site membership removal from the locked row", async () => {
    const f = database([[], [{ id: userId }], [membership]]);
    const source = install(f.calls);
    await revokeSiteMembership("tenant-a", userId, {
      actor: { kind: "staff", userId: actorId },
    });
    expect(source.observations[0]).toMatchObject({
      scope: { kind: "site", siteId: "tenant-a" },
      transition: { kind: "site-role", userId, previousRole: "editor", currentRole: null },
    });
    expect(f.calls.slice(-3)).toEqual(["delete:np_site_memberships", "record", "commit"]);
  });

  it("records super-admin changes with deployment scope and no site picker", async () => {
    const f = database([[], [{ id: userId, isSuperAdmin: false }]]);
    const source = install(f.calls);
    await setSuperAdmin(userId, true, {
      actor: { kind: "system", component: "host.authority" },
    });
    expect(source.prepare).toHaveBeenCalledWith({ db: f.tx, scope: { kind: "deployment" } });
    expect(source.observations[0]).toMatchObject({
      scope: { kind: "deployment" },
      actor: { kind: "system", component: "host.authority" },
      transition: { kind: "super-admin", userId, previous: false, current: true },
    });
    expect(f.calls.slice(-3)).toEqual(["update:np_users", "record", "commit"]);
  });

  it("does not record identical roles, absent membership removal or unchanged super-admin", async () => {
    let f = database([[], [{ id: "tenant-a" }], [{ id: userId }], [membership]]);
    let source = install(f.calls);
    await grantSiteMembership("tenant-a", userId, "editor");
    expect(source.record).not.toHaveBeenCalled();
    expect(f.transaction.insert).not.toHaveBeenCalled();
    f = database([[], [{ id: userId }], []]);
    source = install(f.calls);
    await revokeSiteMembership("tenant-a", userId);
    expect(source.record).not.toHaveBeenCalled();
    expect(f.transaction.delete).not.toHaveBeenCalled();
    f = database([[], [{ id: userId, isSuperAdmin: true }]]);
    source = install(f.calls);
    await setSuperAdmin(userId, true);
    expect(source.record).not.toHaveBeenCalled();
    expect(f.transaction.update).not.toHaveBeenCalled();
  });

  it("captures installation and copies actor identity before an awaited preparation", async () => {
    database([[], [{ id: userId, isSuperAdmin: false }]]);
    const actor = { kind: "staff" as const, userId: actorId };
    const record = vi.fn(() => Promise.resolve());
    setSiteAuthorityObserverV1({
      prepare() {
        actor.userId = userId;
        resetSiteAuthorityObserverV1();
        return Promise.resolve();
      },
      record,
    });
    await setSuperAdmin(userId, true, { actor });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { kind: "staff", userId: actorId } }),
    );
    expect(npGetSiteAuthorityObserverV1()).toBeNull();
  });

  it("propagates preparation failure before any domain read or write", async () => {
    const f = database([]);
    const record = vi.fn(() => Promise.resolve());
    setSiteAuthorityObserverV1({
      prepare: () => Promise.reject(new Error("source unavailable")),
      record,
    });
    await expect(setSuperAdmin(userId, true)).rejects.toThrow("source unavailable");
    expect(f.transaction.select).not.toHaveBeenCalled();
    expect(f.calls).toEqual(["rollback"]);
    expect(record).not.toHaveBeenCalled();
  });

  it("propagates recording failure through the mutation transaction", async () => {
    const f = database([[], [{ id: userId, isSuperAdmin: false }]]);
    setSiteAuthorityObserverV1({
      prepare: () => Promise.resolve(),
      record: () => Promise.reject(new Error("source persistence failed")),
    });
    await expect(setSuperAdmin(userId, true)).rejects.toThrow("source persistence failed");
    expect(f.calls.slice(-2)).toEqual(["update:np_users", "rollback"]);
  });

  it("does not claim a transition when the mutation returns no persisted row", async () => {
    const f = database([[], [{ id: userId, isSuperAdmin: false }]], [], {
      deleted: [],
      updated: [],
    });
    const source = install(f.calls);
    await expect(setSuperAdmin(userId, true)).rejects.toThrow("Failed to set super administrator");
    expect(source.record).not.toHaveBeenCalled();
    expect(f.calls.at(-1)).toBe("rollback");
  });

  it("rejects invalid installed actor identity before database work", async () => {
    const f = database([]);
    const source = install(f.calls);
    await expect(
      setSuperAdmin(userId, true, { actor: { kind: "staff", userId: "not-a-user" } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      setSuperAdmin(userId, true, { actor: { kind: "system", component: "a".repeat(97) } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(source.prepare).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
  });
});
