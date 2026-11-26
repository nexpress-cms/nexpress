import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pgTable, uuid } from "drizzle-orm/pg-core";

import { setLogger, resetLogger, type NpLogger } from "../observability/logger.js";
import type {
  NpAuthUser,
  NpAccessFunction,
  NpCollectionConfig,
  NpCollectionDocumentReader,
} from "../config/types.js";
import {
  getCollectionRuntimeDiagnostics,
  resetCollectionRuntimeDiagnostics,
} from "./diagnostics.js";
import {
  npRunCollectionDocumentResultHooks,
  npAssertCollectionWriteAccess,
  runPostCommit,
  saveDocument,
  type NpTransaction,
  withDeferredPostCommit,
} from "./pipeline.js";
import { registerCollection, resetCollections } from "./registry.js";
import { withCurrentSite } from "../sites/context.js";

describe("caller-transaction pre-write document reads", () => {
  const user: NpAuthUser = {
    id: "22222222-2222-4222-8222-222222222222",
    email: "editor@example.com",
    name: "Editor",
    role: "editor",
    tokenVersion: 0,
  };
  const config: NpCollectionConfig = {
    slug: "flags",
    labels: { singular: "Flag", plural: "Flags" },
    timestamps: false,
    fields: [{ type: "checkbox", name: "enabled", required: true }],
  };
  const table = pgTable("scoped_reader_flags", { id: uuid("id").primaryKey() });
  const document = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "published",
    createdBy: null,
    updatedBy: null,
    visibility: "public",
    siteId: "default",
    enabled: true,
  };

  function transaction(
    rows: Record<string, unknown>[] | Promise<Record<string, unknown>[]> = [
      { ...document, searchVector: null },
    ],
  ) {
    const query: ReturnType<ReturnType<NpTransaction["select"]>["from"]> = Object.assign(
      Promise.resolve(rows),
      {
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        offset: () => query,
        for: () => query,
      },
    );
    return {
      execute: vi.fn<NpTransaction["execute"]>(),
      insert: vi.fn<NpTransaction["insert"]>(),
      update: vi.fn<NpTransaction["update"]>(),
      delete: vi.fn<NpTransaction["delete"]>(),
      select: vi.fn(() => ({ from: () => query })),
    } satisfies NpTransaction;
  }

  afterEach(() => resetCollections());

  it("uses the caller transaction, actor, tenant checks and canonical read hooks, then revokes access", async () => {
    const tx = transaction();
    const readAccess = vi.fn<NpAccessFunction>(({ user: readerUser }) => readerUser === user);
    const readHook = vi.fn(({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      enabled: false,
    }));
    registerCollection("flags", table, {
      ...config,
      access: { read: readAccess },
      hooks: { afterRead: [readHook] },
    });
    const retained: NpCollectionDocumentReader[] = [];
    const writeConfig: NpCollectionConfig = {
      ...config,
      access: {
        create: async ({ readDocument }) => {
          if (!readDocument) throw new Error("Missing transaction reader");
          retained.push(readDocument);
          expect(await readDocument("flags", document.id)).toEqual({ ...document, enabled: false });
          return true;
        },
      },
    };
    await npAssertCollectionWriteAccess(writeConfig, "flags", "create", user, {}, null, tx);
    expect(readAccess).toHaveBeenCalledWith({ user, doc: document });
    expect(readHook).toHaveBeenCalledOnce();
    await expect(retained[0]("flags", document.id)).rejects.toThrow("no longer active");
    expect(tx.select).toHaveBeenCalledOnce();

    readAccess.mockReturnValueOnce(false);
    await expect(
      npAssertCollectionWriteAccess(writeConfig, "flags", "create", user, {}, null, tx),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(readAccess).toHaveBeenCalledTimes(2);
    expect(readHook).toHaveBeenCalledOnce();

    await expect(
      withCurrentSite("other", () =>
        npAssertCollectionWriteAccess(writeConfig, "flags", "create", user, {}, null, tx),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(readAccess).toHaveBeenCalledTimes(2);
    expect(readHook).toHaveBeenCalledOnce();
  });

  it("rejects a read that resolves after its callback has closed without bypassing read access or hooks", async () => {
    let resolveRows: (rows: Record<string, unknown>[]) => void = () => {
      throw new Error("Missing delayed select resolver");
    };
    const rows = new Promise<Record<string, unknown>[]>((resolve) => {
      resolveRows = resolve;
    });
    const tx = transaction(rows);
    const readAccess = vi.fn<NpAccessFunction>(({ user: readerUser }) => readerUser === user);
    const readHook = vi.fn(({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      enabled: false,
    }));
    registerCollection("flags", table, {
      ...config,
      access: { read: readAccess },
      hooks: { afterRead: [readHook] },
    });
    const pending: Promise<Record<string, unknown> | null>[] = [];
    await npAssertCollectionWriteAccess(
      {
        ...config,
        access: {
          create: ({ readDocument }) => {
            if (!readDocument) throw new Error("Missing transaction reader");
            pending.push(readDocument("flags", document.id));
            return true;
          },
        },
      },
      "flags",
      "create",
      user,
      {},
      null,
      tx,
    );
    expect(pending).toHaveLength(1);
    expect(readAccess).not.toHaveBeenCalled();
    expect(readHook).not.toHaveBeenCalled();
    const rejected = expect(pending[0]).rejects.toThrow("no longer active");
    resolveRows([{ ...document, searchVector: null }]);
    await rejected;
    expect(readAccess).toHaveBeenCalledWith({ user, doc: document });
    expect(readHook).toHaveBeenCalledOnce();
    expect(tx.select).toHaveBeenCalledOnce();
  });

  it("omits the reader without a caller transaction and revokes it when an update ACL rejects", async () => {
    const access = vi.fn<NpAccessFunction>(() => false);
    await expect(
      npAssertCollectionWriteAccess(
        { ...config, access: { create: access } },
        "flags",
        "create",
        user,
        {},
        null,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(access.mock.calls[0]?.[0]).not.toHaveProperty("readDocument");

    const retained: NpCollectionDocumentReader[] = [];
    const failure = new Error("Rejected update");
    await expect(
      npAssertCollectionWriteAccess(
        {
          ...config,
          access: {
            update: ({ readDocument }) => {
              if (!readDocument) throw new Error("Missing transaction reader");
              retained.push(readDocument);
              throw failure;
            },
          },
        },
        "flags",
        "update",
        user,
        {},
        document,
        transaction(),
      ),
    ).rejects.toBe(failure);
    await expect(retained[0]("flags", document.id)).rejects.toThrow("no longer active");
  });

  it("gives each pre-write hook a separate reader and revokes both when a hook aborts the save", async () => {
    const tx = transaction();
    const retained: NpCollectionDocumentReader[] = [];
    const failure = new Error("Stop before persistence");
    registerCollection("flags", table, {
      ...config,
      hooks: {
        beforeCreate: [
          ({ data, readDocument }) => {
            if (!readDocument) throw new Error("Missing transaction reader");
            retained.push(readDocument);
            return data;
          },
          async ({ readDocument }) => {
            if (!readDocument) throw new Error("Missing transaction reader");
            retained.push(readDocument);
            await expect(retained[0]("flags", document.id)).rejects.toThrow("no longer active");
            expect(await readDocument("flags", document.id)).toEqual(document);
            throw failure;
          },
        ],
      },
    });
    await expect(saveDocument("flags", null, { enabled: true }, user, { tx })).rejects.toBe(
      failure,
    );
    expect(retained).toHaveLength(2);
    expect(retained[0]).not.toBe(retained[1]);
    await expect(retained[1]("flags", document.id)).rejects.toThrow("no longer active");
    expect(tx.select).toHaveBeenCalledOnce();
    expect(tx.insert).not.toHaveBeenCalled();
  });
});

describe("nested post-commit scopes", () => {
  const context = { collection: "posts", documentId: "document" };

  it("registers journal evidence before commit and dispatches stable nested ordinals after commit", async () => {
    const events: string[] = [];
    let committed = false;
    const observer = {
      register: vi.fn((metadata: { ordinal: number }) => {
        expect(committed).toBe(false);
        events.push(`register:${metadata.ordinal}`);
        return Promise.resolve();
      }),
      dispatch: vi.fn(async (metadata: { ordinal: number }, fn: () => Promise<unknown>) => {
        expect(committed).toBe(true);
        events.push(`dispatch:${metadata.ordinal}`);
        await fn();
      }),
    };
    await withDeferredPostCommit(
      async () => {
        await runPostCommit("first", context, () => {
          events.push("first");
          return Promise.resolve();
        });
        await withDeferredPostCommit(async () => {
          await runPostCommit("second", context, () => {
            events.push("second");
            return Promise.resolve();
          });
        });
        committed = true;
      },
      { observer },
    );
    expect(events).toEqual([
      "register:1",
      "register:2",
      "dispatch:1",
      "first",
      "dispatch:2",
      "second",
    ]);
    expect(observer.register.mock.calls[0]?.[0]).toEqual({ ordinal: 1, label: "first", context });
  });

  it("aborts before dispatch when durable registration fails and forbids replacing a nested observer", async () => {
    const effect = vi.fn(async () => {});
    const observer = {
      register: vi.fn(() => Promise.reject(new Error("journal unavailable"))),
      dispatch: vi.fn(async () => {}),
    };
    await expect(
      withDeferredPostCommit(
        async () => {
          await runPostCommit("first", context, effect);
        },
        { observer },
      ),
    ).rejects.toThrow("journal unavailable");
    expect(observer.dispatch).not.toHaveBeenCalled();
    expect(effect).not.toHaveBeenCalled();
    await expect(
      withDeferredPostCommit(
        async () => {
          await withDeferredPostCommit(async () => {}, { observer: { ...observer } });
        },
        { observer },
      ),
    ).rejects.toThrow("cannot replace");
  });

  it("allows journal dispatch to fence uncertain work without invoking its closure", async () => {
    const effect = vi.fn(async () => {});
    const observer = { register: vi.fn(async () => {}), dispatch: vi.fn(async () => {}) };
    await withDeferredPostCommit(
      async () => {
        await runPostCommit("uncertain", context, effect);
      },
      { observer },
    );
    expect(observer.dispatch).toHaveBeenCalledOnce();
    expect(effect).not.toHaveBeenCalled();
  });

  it("waits for the outer commit and preserves nested FIFO order", async () => {
    const effects: string[] = [];
    await withDeferredPostCommit(async () => {
      await runPostCommit("before", context, () => {
        effects.push("before");
        return Promise.resolve();
      });
      await withDeferredPostCommit(async () => {
        await runPostCommit("nested", context, () => {
          effects.push("nested");
          return Promise.resolve();
        });
      });
      expect(effects).toEqual([]);
      await runPostCommit("after", context, () => {
        effects.push("after");
        return Promise.resolve();
      });
    });
    expect(effects).toEqual(["before", "nested", "after"]);
  });

  it("discards successful inner scopes when the outer transaction rolls back", async () => {
    const effect = vi.fn(async () => {});
    await expect(
      withDeferredPostCommit(async () => {
        await withDeferredPostCommit(async () => {
          await runPostCommit("nested", context, effect);
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(effect).not.toHaveBeenCalled();
  });

  it("discards a failed inner savepoint while retaining successful outer work", async () => {
    const discarded = vi.fn(async () => {});
    const committed = vi.fn(async () => {});
    await withDeferredPostCommit(async () => {
      await expect(
        withDeferredPostCommit(async () => {
          await runPostCommit("discarded", context, discarded);
          throw new Error("savepoint rollback");
        }),
      ).rejects.toThrow("savepoint rollback");
      await runPostCommit("committed", context, committed);
      expect(committed).not.toHaveBeenCalled();
    });
    expect(discarded).not.toHaveBeenCalled();
    expect(committed).toHaveBeenCalledOnce();
  });
});

/**
 * Covers the swallow + log contract for `runPostCommit` (the
 * minimum-viable shim from #277). The full pipeline write path
 * is exercised by integration tests; this file just nails down
 * the contract a future refactor must not break.
 */

describe("runPostCommit (#277)", () => {
  let captured: Array<{
    level: string;
    message: string;
    data: Record<string, unknown> | undefined;
  }> = [];
  const mockLogger: NpLogger = {
    kind: "test",
    debug: () => {},
    info: () => {},
    warn: (message, data) => {
      captured.push({ level: "warn", message, data });
    },
    error: (message, data) => {
      captured.push({ level: "error", message, data });
    },
  };

  beforeEach(() => {
    captured = [];
    setLogger(mockLogger);
  });

  afterEach(() => {
    resetLogger();
  });

  it("calls the side-effect fn and resolves on success", async () => {
    const fn = vi.fn(() => Promise.resolve("ok"));
    await runPostCommit(
      "enqueue:content:afterSave",
      { collection: "posts", documentId: "doc-1", operation: "create" },
      fn,
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(captured).toHaveLength(0);
  });

  it("swallows errors thrown from the side-effect fn", async () => {
    const boom = new Error("pg-boss connection refused");
    const fn = vi.fn(() => Promise.reject(boom));
    // Must NOT throw — the document is already durable; the caller
    // would otherwise see a successful save reported as a failure.
    await expect(
      runPostCommit(
        "enqueue:content:afterSave",
        { collection: "posts", documentId: "doc-1", operation: "create" },
        fn,
      ),
    ).resolves.toBeUndefined();
  });

  it("logs at error level with collection / documentId / label / message / stack", async () => {
    const boom = new Error("pg-boss connection refused");
    await runPostCommit(
      "enqueue:content:afterSave",
      { collection: "posts", documentId: "doc-1", operation: "create" },
      () => Promise.reject(boom),
    );
    expect(captured).toHaveLength(1);
    const entry = captured[0];
    expect(entry.level).toBe("error");
    expect(entry.message).toContain("post-commit");
    expect(entry.message).toContain("enqueue:content:afterSave");
    expect(entry.data).toMatchObject({
      collection: "posts",
      documentId: "doc-1",
      operation: "create",
      label: "enqueue:content:afterSave",
      error: "pg-boss connection refused",
    });
    expect(typeof entry.data?.stack).toBe("string");
  });

  it("handles non-Error throw values (string, object) without crashing", async () => {
    await runPostCommit(
      "hook:content:afterCreate",
      { collection: "posts", documentId: "doc-2" },
      // Reject with a string (not an Error) — the test asserts that
      // runPostCommit handles non-Error throw values without crashing.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      () => Promise.reject("plugin returned undefined"),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].data).toMatchObject({
      error: "plugin returned undefined",
      stack: undefined,
    });
  });

  it("does not invoke the logger when the side-effect succeeds", async () => {
    await runPostCommit(
      "hook:content:afterPublish",
      { collection: "posts", documentId: "doc-3", operation: "update" },
      () => Promise.resolve(undefined),
    );
    expect(captured).toHaveLength(0);
  });
});

describe("collection lifecycle result boundary", () => {
  const config: NpCollectionConfig = {
    slug: "flags",
    labels: { singular: "Flag", plural: "Flags" },
    timestamps: false,
    fields: [{ type: "checkbox", name: "enabled", required: true }],
  };
  const document = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "published",
    createdBy: null,
    updatedBy: null,
    visibility: "public",
    siteId: "default",
    enabled: true,
  };

  afterEach(() => resetCollectionRuntimeDiagnostics());

  it("runs an after-hook once and returns its exact document", async () => {
    const hook = vi.fn(() => Promise.resolve(document));
    await expect(
      npRunCollectionDocumentResultHooks(
        config,
        [hook],
        {
          data: document,
          user: null,
          principal: null,
          collection: "flags",
        },
        "write-result",
      ),
    ).resolves.toEqual(document);
    expect(hook).toHaveBeenCalledOnce();
  });

  it("rejects and diagnoses a malformed hook result", async () => {
    await expect(
      npRunCollectionDocumentResultHooks(
        config,
        [() => Promise.resolve({ ...document, extra: true })],
        {
          data: document,
          user: null,
          principal: null,
          collection: "flags",
        },
        "write-result",
      ),
    ).rejects.toThrow("Invalid collection document");
    expect(getCollectionRuntimeDiagnostics()).toEqual([
      expect.objectContaining({ collection: "flags", operation: "hook-result" }),
    ]);
  });
});
