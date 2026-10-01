import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { npMedia } from "../../../packages/core/src/db/schema/media.js";
import { npObserveMediaStorageV1 } from "../../../packages/core/src/media/operator-observation.js";
import type { NpStorageAdapter } from "../../../packages/core/src/storage/types.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./harness.js";

const siteId = "operator-storage";
async function media(overrides: Partial<typeof npMedia.$inferInsert> = {}) {
  const id = randomUUID();
  const [row] = await (
    await getTestDb()
  )
    .insert(npMedia)
    .values({
      id,
      siteId,
      filename: "original.png",
      originalFilename: "private-name.png",
      mimeType: "image/png",
      filesize: 12,
      hash: "private-content-hash",
      storageKey: `media/${siteId}/${id}/original.png`,
      status: "ready",
      ...overrides,
    })
    .returning();
  return row!;
}
function adapter(exists: NpStorageAdapter["exists"]): NpStorageAdapter {
  return {
    kind: "observation-test",
    exists,
    upload: vi.fn(async () => {
      throw new Error("No writes");
    }),
    delete: vi.fn(async () => {
      throw new Error("No writes");
    }),
    getUrl: vi.fn(async () => {
      throw new Error("No URL resolution");
    }),
    getStream: vi.fn(async () => {
      throw new Error("No content reads");
    }),
  };
}
const authorizeMedia = async () => {};

describe.skipIf(skipIfNoTestDb())("Operator selected media storage observations", () => {
  beforeAll(ensureMigrated);
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("measures existing and missing originals/variants without leaking paths or writing", async () => {
    const a = await media();
    const variantKey = `media/${siteId}/${a.id}/thumbnail.png`;
    await (
      await getTestDb()
    )
      .update(npMedia)
      .set({
        sizes: {
          thumbnail: {
            filename: "thumbnail.png",
            mimeType: "image/png",
            filesize: 5,
            width: 10,
            height: 10,
            storageKey: variantKey,
          },
        },
      })
      .where(eq(npMedia.id, a.id));
    const exists = vi.fn(async (key: string) => key !== variantKey);
    const storage = adapter(exists);
    const result = await npObserveMediaStorageV1({
      siteId,
      mediaIds: [a.id],
      maxTargets: 3,
      adapter: storage,
      authorizeMedia,
    });
    expect(result).toMatchObject({
      status: "complete",
      attemptedTargets: 2,
      checkedTargets: 2,
      presentTargets: 1,
      missingTargets: 1,
      unavailableObservations: 0,
    });
    expect(result.evidenceDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(exists.mock.calls).toEqual([[a.storageKey], [variantKey]]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("media/");
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(storage.getUrl).not.toHaveBeenCalled();
    expect(storage.getStream).not.toHaveBeenCalled();
    expect(
      await npObserveMediaStorageV1({
        siteId,
        mediaIds: [a.id],
        maxTargets: 1,
        adapter: storage,
        authorizeMedia,
      }),
    ).toMatchObject({ status: "truncated", attemptedTargets: 1, checkedTargets: 1 });
  });

  it("never probes foreign, deleted, processing or unowned object keys", async () => {
    const foreign = await media({ siteId: "other-site" });
    const deleted = await media({ deletedAt: new Date() });
    const processing = await media({ status: "processing" });
    const poisoned = await media({ storageKey: "media/other-site/private/original.png" });
    const exists = vi.fn(async () => true);
    const result = await npObserveMediaStorageV1({
      siteId,
      mediaIds: [foreign.id, deleted.id, processing.id, poisoned.id],
      maxTargets: 10,
      adapter: adapter(exists),
      authorizeMedia,
    });
    expect(result).toMatchObject({
      status: "unavailable",
      checkedTargets: 0,
      unavailableObservations: 4,
    });
    expect(exists).not.toHaveBeenCalled();
  });

  it("rechecks caller authority after external reads and discards changed media evidence", async () => {
    const a = await media();
    let allowed = true;
    const authorize = vi.fn(async () => {
      if (!allowed) throw new Error("Revoked");
    });
    const storage = adapter(async () => {
      allowed = false;
      return true;
    });
    await expect(
      npObserveMediaStorageV1({
        siteId,
        mediaIds: [a.id],
        maxTargets: 1,
        adapter: storage,
        authorizeMedia: authorize,
      }),
    ).rejects.toThrow("Revoked");
    const changing = adapter(async () => {
      await (
        await getTestDb()
      )
        .update(npMedia)
        .set({ deletedAt: new Date() })
        .where(eq(npMedia.id, a.id));
      return true;
    });
    expect(
      await npObserveMediaStorageV1({
        siteId,
        mediaIds: [a.id],
        maxTargets: 1,
        adapter: changing,
        authorizeMedia,
      }),
    ).toMatchObject({ status: "unavailable", checkedTargets: 0, presentTargets: 0 });
  });

  it("keeps empty selections and adapter failures unavailable and rejects excessive selections", async () => {
    const a = await media();
    const storage = adapter(async () => {
      throw new Error("credential://private/path");
    });
    const input = { siteId, mediaIds: [a.id], maxTargets: 1, adapter: storage, authorizeMedia };
    const failed = await npObserveMediaStorageV1(input);
    expect(failed).toMatchObject({
      status: "unavailable",
      checkedTargets: 0,
      unavailableObservations: 1,
    });
    expect(JSON.stringify(failed)).not.toContain("credential");
    expect(await npObserveMediaStorageV1({ ...input, mediaIds: [] })).toMatchObject({
      status: "unavailable",
      checkedTargets: 0,
    });
    await expect(npObserveMediaStorageV1({ ...input, maxTargets: 101 })).rejects.toThrow("Invalid");
  });
});
