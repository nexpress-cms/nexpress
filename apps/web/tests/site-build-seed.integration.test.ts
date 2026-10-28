import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getActiveThemeId,
  getNavigation,
  getSetting,
  NpError,
  NpForbiddenError,
  NpValidationError,
} from "@nexpress/core";
import { getCacheInvalidationDiagnostics, npInvalidateCache } from "@nexpress/core/cache";
import { getDocumentById, withDeferredPostCommit } from "@nexpress/core/collections";
import { npRevisions } from "@nexpress/core/db-schema";
import { ensureDefaultSite } from "@nexpress/core/sites";
import { npGetDefaultBuildOwnerBindingsV1 } from "@nexpress/app/config-defaults";
import {
  npMaterializeSiteBuildSeedV1,
  npRequireSiteBuildSeedArtifactV1,
} from "@nexpress/app/lib/site-build-seed";
// eslint-disable-next-line import-x/no-relative-packages
import communitySeed from "../../../packages/app/src/lib/__fixtures__/site-build-community-seed.json" with { type: "json" };

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { reloadPlugins } from "@/lib/bootstrap";
import { ensureFor } from "@/lib/init-core";

async function seedActor() {
  const staff = await seedUser({ role: "admin" });
  return {
    id: staff.userId,
    email: staff.email,
    name: staff.name,
    role: staff.role,
    tokenVersion: 0,
  };
}

async function expectStoredDocuments(
  seed: ReturnType<typeof npRequireSiteBuildSeedArtifactV1>,
  actor: Awaited<ReturnType<typeof seedActor>>,
  options?: Parameters<typeof getDocumentById>[3],
) {
  for (const document of seed.seed.documents) {
    expect(
      await getDocumentById(document.collection, document.documentId, actor, options),
    ).toMatchObject({
      ...document.data,
      id: document.documentId,
      status: "published",
      ...(document.locale !== null
        ? { locale: document.locale, translationGroupId: document.translationGroupId }
        : {}),
    });
  }
}

async function readThemeAndNavigation() {
  return {
    themeId: await getActiveThemeId(),
    tokens: await getSetting("theme"),
    navigation: await getNavigation("header"),
  };
}

describe.skipIf(skipIfNoTestDb())("site build seed through the actual reference bootstrap", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFor("write");
    await ensureDefaultSite();
    // TRUNCATE removes plugin installation rows while bootstrap remains initialized.
    await reloadPlugins();
  });

  // Integration files share the worker's bootstrap (isolate:false). This suite
  // owns only its DB harness; terminal bootstrap shutdown would break later files.
  afterAll(closeTestDb);

  it("publishes the four actual Community documents and replays their exact stored projection", async () => {
    const seed = npRequireSiteBuildSeedArtifactV1(communitySeed);
    expect(seed.seed.documents.map((document) => document.collection)).toEqual([
      "forum-boards",
      "forum-posts",
      "pages",
      "pages",
    ]);
    const actor = await seedActor();
    const options = {
      ownerBindings: npGetDefaultBuildOwnerBindingsV1(),
      status: "published" as const,
    };
    const documentIds = seed.seed.documents.map((document) => document.documentId);
    let phase = "materialize-first";
    try {
      const first = await npMaterializeSiteBuildSeedV1(seed, actor, options);
      expect(first.documents).toEqual({ created: documentIds, unchanged: [] });
      expect(first.transaction).toBe("individual-facade-commits");
      expect(first.media.fetched).toBe(0);
      expect(first.media.uploaded).toBe(0);

      phase = "materialize-replay";
      const repeated = await npMaterializeSiteBuildSeedV1(seed, actor, options);
      expect(repeated.documents).toEqual({ created: [], unchanged: documentIds });
      expect(repeated.theme).toBe("unchanged");
      expect(repeated.navigation).toEqual({
        created: [],
        unchanged: seed.navigation.map((navigation) => navigation.location),
      });
    } catch (error) {
      if (!(error instanceof NpError)) throw error;
      // Keep the real contract failure visible without logging document/session data.
      const message =
        error.message ===
        "Normal save hooks changed the exact seed projection; reconcile or roll back the caller transaction."
          ? error.message
          : "The normal seed pipeline rejected the synthetic fixture.";
      throw new Error(
        JSON.stringify({
          phase,
          name: error.name,
          code: error.code,
          statusCode: error.statusCode,
          message,
          fields: error instanceof NpValidationError ? error.errors.map(({ field }) => field) : [],
        }),
      );
    }
  });

  it("creates the board and dependent post and replays them inside the caller transaction", async () => {
    const seed = npRequireSiteBuildSeedArtifactV1(communitySeed);
    const actor = await seedActor();
    const db = await getTestDb();
    const documentIds = seed.seed.documents.map((document) => document.documentId);
    const attemptsBefore = getCacheInvalidationDiagnostics().attempts;
    const first = await withDeferredPostCommit(() =>
      db.transaction(async (tx) => {
        const options = {
          ownerBindings: npGetDefaultBuildOwnerBindingsV1(),
          status: "published" as const,
          tx,
        };
        const created = await npMaterializeSiteBuildSeedV1(seed, actor, options);
        expect(created.documents).toEqual({ created: documentIds, unchanged: [] });
        expect(created.transaction).toBe("caller-owned");
        expect(created.cacheInvalidations).toEqual([]);
        expect(created.pendingCacheInvalidations.length).toBeGreaterThan(0);
        await expectStoredDocuments(seed, actor, { tx });
        const revisions = await tx
          .select()
          .from(npRevisions)
          .where(inArray(npRevisions.documentId, documentIds))
          .orderBy(npRevisions.id);

        const repeated = await npMaterializeSiteBuildSeedV1(seed, actor, options);
        expect(repeated.documents).toEqual({ created: [], unchanged: documentIds });
        expect(repeated.transaction).toBe("caller-owned");
        expect(repeated.theme).toBe("unchanged");
        expect(repeated.navigation).toEqual({
          created: [],
          unchanged: seed.navigation.map((navigation) => navigation.location),
        });
        expect(repeated.pendingCacheInvalidations).toEqual([]);
        expect(
          await tx
            .select()
            .from(npRevisions)
            .where(inArray(npRevisions.documentId, documentIds))
            .orderBy(npRevisions.id),
        ).toEqual(revisions);
        expect(getCacheInvalidationDiagnostics().attempts).toBe(attemptsBefore);
        return created;
      }),
    );

    for (const request of first.pendingCacheInvalidations) await npInvalidateCache(request);
    expect(getCacheInvalidationDiagnostics().attempts).toBeGreaterThan(attemptsBefore);
    await expectStoredDocuments(seed, actor);
  });

  it("rolls back the completed seed and deferred effects when the caller later fails", async () => {
    const seed = npRequireSiteBuildSeedArtifactV1(communitySeed);
    const actor = await seedActor();
    const db = await getTestDb();
    const documentIds = seed.seed.documents.map((document) => document.documentId);
    const before = await readThemeAndNavigation();
    const attemptsBefore = getCacheInvalidationDiagnostics().attempts;
    const failure = new Error("Synthetic failure after seed materialization");

    await expect(
      withDeferredPostCommit(() =>
        db.transaction(async (tx) => {
          const materialized = await npMaterializeSiteBuildSeedV1(seed, actor, {
            ownerBindings: npGetDefaultBuildOwnerBindingsV1(),
            status: "published",
            tx,
          });
          expect(materialized.documents.created).toEqual(documentIds);
          await expectStoredDocuments(seed, actor, { tx });
          expect(getCacheInvalidationDiagnostics().attempts).toBe(attemptsBefore);
          throw failure;
        }),
      ),
    ).rejects.toBe(failure);

    for (const document of seed.seed.documents)
      expect(await getDocumentById(document.collection, document.documentId, actor)).toBeNull();
    expect(
      await db.select().from(npRevisions).where(inArray(npRevisions.documentId, documentIds)),
    ).toEqual([]);
    expect(await readThemeAndNavigation()).toEqual(before);
    expect(getCacheInvalidationDiagnostics().attempts).toBe(attemptsBefore);
  });

  it("keeps closed-board post creation forbidden inside the caller transaction", async () => {
    const input = structuredClone(npRequireSiteBuildSeedArtifactV1(communitySeed));
    const board = input.seed.documents.find((document) => document.collection === "forum-boards");
    if (!board) throw new Error("The actual Community fixture must include its board");
    board.data.writeMode = "closed";
    const seed = npRequireSiteBuildSeedArtifactV1(input);
    const actor = await seedActor();
    const db = await getTestDb();
    const documentIds = seed.seed.documents.map((document) => document.documentId);
    const before = await readThemeAndNavigation();
    const attemptsBefore = getCacheInvalidationDiagnostics().attempts;

    const failure = await withDeferredPostCommit(() =>
      db.transaction((tx) =>
        npMaterializeSiteBuildSeedV1(seed, actor, {
          ownerBindings: npGetDefaultBuildOwnerBindingsV1(),
          status: "published",
          tx,
        }),
      ),
    ).then(
      () => {
        throw new Error("A closed board must reject the dependent post");
      },
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(NpForbiddenError);
    expect(failure).toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    for (const document of seed.seed.documents)
      expect(await getDocumentById(document.collection, document.documentId, actor)).toBeNull();
    expect(
      await db.select().from(npRevisions).where(inArray(npRevisions.documentId, documentIds)),
    ).toEqual([]);
    expect(await readThemeAndNavigation()).toEqual(before);
    expect(getCacheInvalidationDiagnostics().attempts).toBe(attemptsBefore);
  });
});
