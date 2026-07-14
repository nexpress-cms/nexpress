import { getScopedLogger } from "./logger.js";

/**
 * Inputs to {@link verifyStartupSafety}. The bootstrap layer
 * (`packages/next/src/bootstrap.ts`) reads the resolved config and the
 * relevant env vars and hands them in — keeping this helper a pure
 * function of its input means it stays trivially testable and never
 * accidentally reads `process.env` from a deeper code path.
 */
export interface NpStartupSafetyInput {
  /** Storage adapter id chosen by `createStorageAdapter` (`local` or `s3`). */
  storageAdapter: "local" | "s3";
  /** Resolved auth secret. `null` when unset. */
  secret: string | null;
  /** `process.env.NODE_ENV` at boot — typically `"production"` / `"development"` / undefined. */
  nodeEnv: string | undefined;
  /**
   * `process.env.NP_MULTI_NODE` at boot. When the operator opts into
   * multi-node mode we tighten checks that are otherwise just hints.
   */
  multiNodeFlag: string | undefined;
  /**
   * `process.env.NP_REPLICAS` at boot. Values greater than 1 are an
   * explicit multi-node signal even when `NP_MULTI_NODE` is unset.
   */
  replicasFlag?: string | undefined;
  /**
   * True when the boot environment looks like a managed container
   * runtime (Kubernetes / Fly.io / Render / similar). The bootstrap
   * layer evaluates the well-known env vars and hands a single bool
   * in so this helper stays a pure function. We use this together
   * with `nodeEnv === "production"` to catch the common footgun
   * where an operator deploys to a multi-replica platform and forgot
   * to set `NP_MULTI_NODE=true`. Optional for back-compat with
   * callers that don't supply it (treated as `false`).
   */
  containerEnv?: boolean;
  /**
   * Value of `NP_EMAIL_ADAPTER` at boot. Pass `null` when the env
   * var is unset, the literal string when it is — we check the
   * **operator's intent** rather than the live adapter because the
   * adapter is configured later in the boot sequence (after the
   * core-services step that runs this safety check). Use `null` /
   * `"noop"` to mean "operator hasn't asked for a real adapter,
   * warn in production." Programmatic adapters must select the
   * exact `"custom"` mode before calling `setEmailAdapter()`.
   */
  emailAdapterEnv?: string | null;
  /**
   * Hostname extracted from `DATABASE_URL`. Optional for back-compat.
   * When provided and the host looks like loopback (`localhost` /
   * `127.0.0.1` / `::1`) AND `nodeEnv === "production"`, we warn —
   * the operator likely shipped the dev DB connection string.
   */
  databaseHost?: string | null;
  /**
   * Resolved `SITE_URL` (or equivalent base URL) at boot. Optional
   * for back-compat. When unset OR loopback-shaped in production,
   * we warn — links, SEO canonical URLs, OAuth callbacks, sitemap
   * URLs all anchor on this value.
   */
  siteUrl?: string | null;
  /**
   * Whether the operator has opted into a custom rate-limiter
   * adapter via `setRateLimiter(...)`. `false` means the default
   * `InMemoryRateLimiter` will be lazily installed on first use —
   * fine for single-node, but per-node buckets in multi-replica
   * deploys make the limit ~Nx looser than configured. Optional
   * for back-compat; `undefined` skips the check.
   */
  rateLimiterCustom?: boolean;
}

const MIN_PROD_SECRET_LENGTH = 32;

/**
 * Surfaces operationally-bitten misconfiguration as warnings during
 * boot. The set is intentionally small — every entry has to map to
 * a real failure mode that has either bitten the project or been
 * called out in the deployment docs:
 *
 *   - `LocalStorageAdapter` + `NP_MULTI_NODE=true` or
 *     `NP_REPLICAS>1`. Different nodes see different `./uploads`
 *     directories; uploads disappear between requests.
 *     (`docs/deployment.md` — Multi-node notes.)
 *   - `LocalStorageAdapter` + `NODE_ENV=production` + a managed-
 *     container env var (`KUBERNETES_SERVICE_HOST`, `FLY_REGION`,
 *     `RENDER_INSTANCE_ID`, `RAILWAY_ENVIRONMENT_NAME`, …). Same
 *     failure mode as above; this branch catches the operator who
 *     forgot to set `NP_MULTI_NODE` but is clearly running on a
 *     multi-replica platform.
 *   - `NODE_ENV=production` + missing or short `NP_SECRET`. Tokens
 *     signed with a weak secret are forgeable. We cap below 32 bytes
 *     because that's the floor `signJwt` documents.
 *   - `NODE_ENV=production` + `emailAdapterKind === "noop"` (#597).
 *     Transactional mail (password reset, email verify, member
 *     digests) silently dropped — operators expect those to deliver.
 *   - `NODE_ENV=production` + `databaseHost` looks like loopback
 *     (#597). `localhost` / `127.0.0.1` / `::1` in a prod deploy is
 *     almost always a stale dev `DATABASE_URL` that slipped through.
 *   - `NODE_ENV=production` + `siteUrl` unset or loopback-shaped
 *     (#597). Sitemap URLs, SEO canonical URLs, OAuth callbacks,
 *     transactional mail links all anchor on this — wrong value
 *     manifests as broken share links and unverifiable OAuth round-
 *     trips, which take a while for the operator to notice.
 *
 * Warnings go through {@link getScopedLogger} so production deploys
 * that have called `setLogger(...)` get them in their structured-log
 * pipeline (Datadog, Axiom, etc.) instead of stdout. Returns the list
 * of emitted warning ids so callers can assert on them in tests; in
 * production nothing inspects the return value.
 */
export function verifyStartupSafety(input: NpStartupSafetyInput): readonly string[] {
  const log = getScopedLogger({ subsystem: "boot" });
  const emitted: string[] = [];

  const multiNode = envFlagIsTrue(input.multiNodeFlag);
  const replicaCount = parseReplicaCount(input.replicasFlag);
  const replicaMultiNode = replicaCount !== null && replicaCount > 1;
  const explicitOptOut =
    !replicaMultiNode && (envFlagIsFalse(input.multiNodeFlag) || replicaCount === 1);
  // Explicit opt-out wins over the container heuristic: an
  // operator who deliberately sets `NP_MULTI_NODE=false` on a
  // managed-container deploy (single-replica on Kubernetes, etc.)
  // should not see the hint, otherwise the warning the message
  // tells them to silence isn't actually silenceable.
  const containerInProd =
    !explicitOptOut && input.nodeEnv === "production" && Boolean(input.containerEnv);
  const likelyMultiNode = multiNode || replicaMultiNode || containerInProd;

  if (likelyMultiNode && input.storageAdapter === "local") {
    const reason = multiNode
      ? "explicit_flag"
      : replicaMultiNode
        ? "replica_count"
        : "container_hint";
    const trigger = multiNode
      ? "NP_MULTI_NODE is set"
      : replicaMultiNode
        ? `NP_REPLICAS=${replicaCount.toString()}`
        : "a managed-container env var was detected in production (KUBERNETES_SERVICE_HOST / FLY_REGION / RENDER_INSTANCE_ID / RAILWAY_ENVIRONMENT_NAME)";
    log.warn(
      `LocalStorageAdapter is not multi-node safe — ${trigger} but ./uploads is per-process. ` +
        "Set NP_STORAGE_ADAPTER=s3 (or NP_MULTI_NODE=false / NP_REPLICAS=1 to silence the hint on a single-node deploy).",
      { check: "multi_node_local_storage", reason },
    );
    emitted.push("multi_node_local_storage");
  }

  // The default in-memory rate limiter is per-process. On a
  // multi-replica deploy each pod tracks its own buckets, so a
  // configured "5 login attempts / minute" effectively becomes
  // "5 × N pods" — the gate is looser than the operator thinks.
  // Same likely-multi-node detection as storage. `rateLimiterCustom
  // === false` means the operator hasn't called `setRateLimiter()`,
  // so the default will be installed on first request. `undefined`
  // (caller didn't supply) skips the check.
  if (likelyMultiNode && input.rateLimiterCustom === false) {
    const reason = multiNode
      ? "explicit_flag"
      : replicaMultiNode
        ? "replica_count"
        : "container_hint";
    log.warn(
      "InMemoryRateLimiter is not multi-node safe — buckets are per-process, so a multi-replica deploy multiplies the effective limit by the replica count. " +
        "Install a shared adapter via `setRateLimiter(new RedisRateLimiter(...))` (or your own backing store), or `NP_MULTI_NODE=false` / `NP_REPLICAS=1` to silence this on a single-node deploy.",
      { check: "multi_node_in_memory_rate_limiter", reason },
    );
    emitted.push("multi_node_in_memory_rate_limiter");
  }

  if (input.nodeEnv === "production") {
    if (!input.secret) {
      log.warn(
        "NP_SECRET is unset in production — JWT sessions are signed with an empty key, which is forgeable.",
        { check: "missing_prod_secret" },
      );
      emitted.push("missing_prod_secret");
    } else if (input.secret.length < MIN_PROD_SECRET_LENGTH) {
      log.warn(
        `NP_SECRET is shorter than ${MIN_PROD_SECRET_LENGTH} characters in production — pick a longer secret to avoid weak-key attacks.`,
        { check: "weak_prod_secret", length: input.secret.length },
      );
      emitted.push("weak_prod_secret");
    }

    // Email adapter intent comes from `NP_EMAIL_ADAPTER` (env-driven
    // path, the typical setup). Unset / "noop" → operator hasn't
    // asked for a real adapter; transactional mail (password reset,
    // email verify, member digests) silently disappears. We check
    // the env var rather than the live adapter because adapters get
    // wired AFTER this safety check runs in the boot sequence — a
    // live-adapter check would always see `noop`. Programmatic
    // adapters select the exact `custom` mode so this intent check
    // can distinguish them from the default.
    if (
      input.emailAdapterEnv === undefined
        ? false // back-compat: caller didn't supply
        : input.emailAdapterEnv === null || input.emailAdapterEnv === "noop"
    ) {
      log.warn(
        "NP_EMAIL_ADAPTER is unset (or `noop`) in production — transactional mail (password reset, email verify, member digests) is silently dropped. " +
          "Set NP_EMAIL_ADAPTER=smtp + the NP_SMTP_* config, or set NP_EMAIL_ADAPTER=custom and install an adapter via setEmailAdapter() before the first write bootstrap.",
        { check: "noop_email_in_prod" },
      );
      emitted.push("noop_email_in_prod");
    }

    if (input.databaseHost && isLoopbackHost(input.databaseHost)) {
      log.warn(
        `DATABASE_URL host is "${input.databaseHost}" in production — that's loopback, almost certainly a stale dev connection string. ` +
          "Point DATABASE_URL at the production Postgres instance.",
        { check: "loopback_database_in_prod", host: input.databaseHost },
      );
      emitted.push("loopback_database_in_prod");
    }

    // siteUrl undefined === "caller (older bootstrap) didn't supply
    // info, skip the check"; siteUrl === null === "caller checked and
    // confirmed it's unset". Only the explicit-null case warns. This
    // back-compat shape lets `verifyStartupSafety` evolve its input
    // surface without breaking existing call sites whose tests didn't
    // know to set the new fields.
    if (input.siteUrl === null) {
      log.warn(
        "SITE_URL is unset in production — sitemap URLs, SEO canonical URLs, OAuth callbacks, and email links anchor on it. " +
          "Set SITE_URL to your public origin (e.g. https://example.com).",
        { check: "missing_site_url" },
      );
      emitted.push("missing_site_url");
    } else if (typeof input.siteUrl === "string" && isLoopbackUrl(input.siteUrl)) {
      log.warn(
        `SITE_URL is "${input.siteUrl}" in production — loopback origins break share links, OAuth round-trips, and outbound email links. ` +
          "Set SITE_URL to your public origin.",
        { check: "loopback_site_url", siteUrl: input.siteUrl },
      );
      emitted.push("loopback_site_url");
    }
  }

  return emitted;
}

function parseReplicaCount(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function envFlagIsTrue(value: string | undefined): boolean {
  const normalized = value?.toLowerCase();
  return normalized === "true" || normalized === "1";
}

function envFlagIsFalse(value: string | undefined): boolean {
  const normalized = value?.toLowerCase();
  return normalized === "false" || normalized === "0";
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // IPv6 hostnames keep their square brackets in `URL.hostname`
    // (e.g. `new URL("http://[::1]/").hostname === "[::1]"`). Strip
    // them so the comparison hits our canonical loopback set.
    const host = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "");
    return isLoopbackHost(host);
  } catch {
    // Malformed URL — treat as not-loopback so we don't double-warn.
    // The caller's own URL parser will surface the malformation.
    return false;
  }
}
