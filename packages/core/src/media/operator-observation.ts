import { createHash } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import { getDb } from "../db/runtime.js";
import { npMedia } from "../db/schema/media.js";
import { NpValidationError } from "../errors.js";
import { npValidateMediaVariants } from "../media-contract/contract.js";
import { npRequireStorageKey } from "../storage/contract.js";
import { npStorageObjectExists } from "../storage/operations.js";
import type { NpStorageAdapter } from "../storage/types.js";

export interface NpMediaStorageObservationInputV1 {
  siteId: string;
  /** Explicit host-selected records; this operation does not discover media. */
  mediaIds: readonly string[];
  /** Total original/variant object HEAD-equivalent probes, at most 100. */
  maxTargets: number;
  adapter: NpStorageAdapter;
  /** Must enforce current requester authority, media and referenced item ACLs. */
  authorizeMedia(input: { siteId: string; mediaId: string }): Promise<void>;
}

export interface NpMediaStorageObservationV1 {
  /** Completeness applies only to the explicitly selected records. */
  status: "complete" | "truncated" | "unavailable";
  /** Includes failed probes and probes discarded after authority/version checks. */
  attemptedTargets: number;
  checkedTargets: number;
  presentTargets: number;
  missingTargets: number;
  /** Unreadable/changed records or failed probes; not an inferred object count. */
  unavailableObservations: number;
  /** Commits the selected record versions and observed outcomes; contains no locator. */
  evidenceDigest: string;
}

/** Read-only bounded observation through the validated storage facade. */
export async function npObserveMediaStorageV1(
  input: NpMediaStorageObservationInputV1,
): Promise<NpMediaStorageObservationV1> {
  if (
    !npIsCanonicalSiteId(input.siteId) ||
    !Number.isInteger(input.maxTargets) ||
    input.maxTargets < 1 ||
    input.maxTargets > 100 ||
    input.mediaIds.length > 100 ||
    new Set(input.mediaIds).size !== input.mediaIds.length ||
    input.mediaIds.some((id) => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id))
  ) {
    throw new NpValidationError("Invalid media storage observation selection.", [
      {
        field: "selection",
        message: "Use a site, at most 100 unique media IDs and a probe limit from 1 to 100.",
      },
    ]);
  }
  const result: NpMediaStorageObservationV1 = {
    status: input.mediaIds.length ? "complete" : "unavailable",
    attemptedTargets: 0,
    checkedTargets: 0,
    presentTargets: 0,
    missingTargets: 0,
    unavailableObservations: 0,
    evidenceDigest: "",
  };
  const facts: unknown[] = ["np.media-storage-observation.v1", input.siteId, input.maxTargets];
  let dispatched = 0;
  const observedVersions = new Map<string, string>();
  const db = getDb();
  const read = async (mediaId: string) => {
    const [row] = await db
      .select({
        storageKey: npMedia.storageKey,
        sizes: npMedia.sizes,
        status: npMedia.status,
        updatedAt: npMedia.updatedAt,
      })
      .from(npMedia)
      .where(
        and(eq(npMedia.siteId, input.siteId), eq(npMedia.id, mediaId), isNull(npMedia.deletedAt)),
      )
      .limit(1);
    return row;
  };
  for (const mediaId of input.mediaIds) {
    const authority = () => input.authorizeMedia({ siteId: input.siteId, mediaId });
    await authority();
    const row = await read(mediaId);
    await authority();
    if (!row || row.status !== "ready" || (row.sizes && !npValidateMediaVariants(row.sizes).ok)) {
      result.status = "unavailable";
      result.unavailableObservations++;
      facts.push([mediaId, "unavailable"]);
      continue;
    }
    const version = JSON.stringify(row);
    const keys = [row.storageKey, ...Object.values(row.sizes ?? {}).map((v) => v.storageKey)];
    const prefix = `media/${input.siteId}/${mediaId}/`;
    let valid = true;
    try {
      for (const key of keys) {
        npRequireStorageKey(key);
        if (!key.startsWith(prefix)) valid = false;
      }
    } catch {
      valid = false;
    }
    if (!valid || new Set(keys).size !== keys.length) {
      result.status = "unavailable";
      result.unavailableObservations++;
      facts.push([mediaId, "unavailable"]);
      continue;
    }
    const outcomes: Array<boolean | null> = [];
    let changed = false;
    for (const key of keys) {
      if (dispatched === input.maxTargets) {
        if (result.status !== "unavailable") result.status = "truncated";
        break;
      }
      await authority();
      dispatched++;
      let outcome: boolean | null = null;
      try {
        outcome = await npStorageObjectExists(input.adapter, key);
      } catch {
        // Adapter errors can contain credentials or locators. Retain no raw error.
      }
      await authority();
      if (JSON.stringify(await read(mediaId)) !== version) {
        changed = true;
        break;
      }
      await authority();
      outcomes.push(outcome);
    }
    if (changed) {
      result.status = "unavailable";
      result.unavailableObservations++;
      facts.push([mediaId, "changed"]);
      continue;
    }
    for (const outcome of outcomes) {
      if (outcome === null) {
        result.status = "unavailable";
        result.unavailableObservations++;
      } else {
        result.checkedTargets++;
        if (outcome) result.presentTargets++;
        else result.missingTargets++;
      }
    }
    observedVersions.set(mediaId, version);
    facts.push([mediaId, version, outcomes]);
  }
  // A later probe may revoke access to an earlier selected record. Recheck the
  // whole selected scope before releasing aggregated observations.
  for (const mediaId of input.mediaIds) {
    await input.authorizeMedia({ siteId: input.siteId, mediaId });
    const expected = observedVersions.get(mediaId);
    if (expected !== undefined && JSON.stringify(await read(mediaId)) !== expected) {
      result.status = "unavailable";
      result.checkedTargets = 0;
      result.presentTargets = 0;
      result.missingTargets = 0;
      result.unavailableObservations++;
      facts.push([mediaId, "changed-before-release"]);
    }
    await input.authorizeMedia({ siteId: input.siteId, mediaId });
  }
  result.attemptedTargets = dispatched;
  result.evidenceDigest = createHash("sha256").update(JSON.stringify(facts)).digest("hex");
  return result;
}
