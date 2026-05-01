import { getScopedLogger } from "./logger.js";

/**
 * Inputs to {@link verifyStartupSafety}. The bootstrap layer
 * (`packages/next/src/bootstrap.ts`) reads the resolved config and the
 * relevant env vars and hands them in — keeping this helper a pure
 * function of its input means it stays trivially testable and never
 * accidentally reads `process.env` from a deeper code path.
 */
export interface NxStartupSafetyInput {
  /** Storage adapter id chosen by `createStorageAdapter` (`local` or `s3`). */
  storageAdapter: "local" | "s3";
  /** Resolved auth secret. `null` when unset. */
  secret: string | null;
  /** `process.env.NODE_ENV` at boot — typically `"production"` / `"development"` / undefined. */
  nodeEnv: string | undefined;
  /**
   * `process.env.NX_MULTI_NODE` at boot. When the operator opts into
   * multi-node mode we tighten checks that are otherwise just hints.
   */
  multiNodeFlag: string | undefined;
}

const MIN_PROD_SECRET_LENGTH = 32;

/**
 * Surfaces operationally-bitten misconfiguration as warnings during
 * boot (Phase 22.2). The set is intentionally small — every entry has
 * to map to a real failure mode that has either bitten the project or
 * been called out in the deployment docs:
 *
 *   - `LocalStorageAdapter` + `NX_MULTI_NODE=true`. Different nodes
 *     see different `./uploads` directories; uploads disappear
 *     between requests. (`docs/deployment.md` — Multi-node notes.)
 *   - `NODE_ENV=production` + missing or short `NX_SECRET`. Tokens
 *     signed with a weak secret are forgeable. We cap below 32 bytes
 *     because that's the floor `signJwt` documents.
 *
 * Warnings go through {@link getScopedLogger} so production deploys
 * that have called `setLogger(...)` get them in their structured-log
 * pipeline (Datadog, Axiom, etc.) instead of stdout. Returns the list
 * of emitted warning ids so callers can assert on them in tests; in
 * production nothing inspects the return value.
 */
export function verifyStartupSafety(input: NxStartupSafetyInput): readonly string[] {
  const log = getScopedLogger({ subsystem: "boot" });
  const emitted: string[] = [];

  const multiNode = input.multiNodeFlag === "true" || input.multiNodeFlag === "1";

  if (multiNode && input.storageAdapter === "local") {
    log.warn(
      "LocalStorageAdapter is not multi-node safe — different nodes will see different ./uploads directories. " +
        "Set NX_STORAGE_ADAPTER=s3 (or unset NX_MULTI_NODE for single-node deploys).",
      { check: "multi_node_local_storage" },
    );
    emitted.push("multi_node_local_storage");
  }

  if (input.nodeEnv === "production") {
    if (!input.secret) {
      log.warn(
        "NX_SECRET is unset in production — JWT sessions are signed with an empty key, which is forgeable.",
        { check: "missing_prod_secret" },
      );
      emitted.push("missing_prod_secret");
    } else if (input.secret.length < MIN_PROD_SECRET_LENGTH) {
      log.warn(
        `NX_SECRET is shorter than ${MIN_PROD_SECRET_LENGTH} characters in production — pick a longer secret to avoid weak-key attacks.`,
        { check: "weak_prod_secret", length: input.secret.length },
      );
      emitted.push("weak_prod_secret");
    }
  }

  return emitted;
}
