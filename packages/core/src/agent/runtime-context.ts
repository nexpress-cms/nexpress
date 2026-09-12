import { createHash } from "node:crypto";
import { and, asc, eq, lt } from "drizzle-orm";
import { npAgentProviderCalls } from "../db/schema/agent.js";
import { npRequireAgentRuntimeProviderDecisionV1 } from "./runtime-provider-evidence.js";
import {
  buildAgentCanonicalFoundationBytes,
  serializeAgentCanonicalJson,
} from "../agent-contract/canonical-foundation.js";
import { npRequireAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import {
  npRequireAgentEvidenceRequestV1,
  npRequireAgentProviderRequestCanonical,
} from "../agent-contract/canonical-provider.js";
import { npRequireAgentReadCapabilityOutputV1 } from "../agent-contract/read-capability-contract.js";
import {
  npIsAgentRuntimeDocumentEvidenceReaderV1,
  type NpAgentRuntimeDocumentEvidenceReaderV1,
} from "./read-capability-executors.js";
import {
  npAgentProviderDataClassRank,
  type NpAgentCapabilityRegistryEntryCanonicalV1,
  type NpAgentCapabilityId,
  type NpAgentEvidenceRequest,
  type NpAgentJsonObject,
  type NpAgentProviderContextClassificationV1,
  type NpAgentProviderRequestCanonicalV1,
} from "../agent-contract/types.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import type {
  NpAgentRuntimeAdmissionV1,
  NpAgentRuntimeExecutionClaimV1,
  NpAgentRuntimeRunContextV1,
} from "./runtime-admission.js";

type Context = Readonly<Omit<NpAgentRuntimeRunContextV1, "db">>;
type Request = NpAgentProviderRequestCanonicalV1;

/** Existing installed descriptor entries, never model or plugin-defined tool declarations. */
export interface NpAgentRuntimeContextCapabilitySourceV1 {
  list(context: Context): readonly {
    canonical: NpAgentCapabilityRegistryEntryCanonicalV1;
    capabilityFingerprint: string;
  }[];
  /** Shared invocation facade: verifies retained linkage and current item authority. */
  actionOutcomes?(context: NpAgentRuntimeRunContextV1): Promise<
    readonly {
      capabilityId: NpAgentCapabilityId;
      state: "succeeded";
      safeCode: null;
    }[]
  >;
}

export interface NpAgentRuntimeContextOptionsV1 {
  admission: NpAgentRuntimeAdmissionV1;
  capabilities?: NpAgentRuntimeContextCapabilitySourceV1;
  documentEvidence?: NpAgentRuntimeDocumentEvidenceReaderV1;
}

export interface NpAgentRuntimeContextPrepareInputV1 {
  siteId: string;
  runId: string;
  providerCallId: string;
  sequence: number;
  retryOfId: string | null;
  idempotencyKey: string;
  claim?: NpAgentRuntimeExecutionClaimV1;
  evidence?: readonly NpAgentEvidenceRequest[];
}

export interface NpAgentRuntimeContextV1 {
  prepare(input: NpAgentRuntimeContextPrepareInputV1): Promise<Request>;
  /** The existing usage-admission source verification seam, including current item reads. */
  verifyRequest(
    context: Context,
    request: Request,
    transaction?: { db: NpAgentRuntimeRunContextV1["db"] },
  ): Promise<boolean>;
  forget(providerCallId: string): void;
  dispose(): void;
}

function unavailable(): never {
  throw new NpAgentGatewayError(
    "RUNTIME_PROVIDER_INPUT_UNAVAILABLE",
    409,
    "Agent runtime context is unavailable.",
  );
}

function hash(domain: string, value: unknown): string {
  return `cj1:sha256:${createHash("sha256").update(domain).update("\0").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
}

function classification(
  sourceDigest: string,
  dataClass: NpAgentProviderContextClassificationV1["dataClass"] = "internal-redacted",
): NpAgentProviderContextClassificationV1 {
  return {
    sourceDigest,
    dataClass,
    classifierId: "framework.runtime-context",
    classifierVersion: 1,
  };
}

/** Defense in depth; unstructured text retains its sensitive-approved class. */
function redactText(text: string): string {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu,
      "[redacted credential]",
    )
    .replace(
      /\b(?:npst1\.[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~-]+)\b/gu,
      "[redacted credential]",
    )
    .replace(/\b(?:postgres(?:ql)?|mysql|redis):\/\/[^\s"<>]+/gu, "[redacted connection]")
    .replace(
      /\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/gu,
      "[redacted email]",
    );
}

/** The private manifest shared by the builder and the existing usage ledger. */
export function npBuildAgentRuntimeClassificationManifestV1(request: Request): NpAgentJsonObject {
  return {
    components: [
      {
        id: request.instruction.templateId,
        kind: "instruction",
        ...request.instruction.classification,
      },
      ...request.trustedContext.map(({ id, kind, classification }) => ({
        id,
        kind,
        ...classification,
      })),
      ...request.untrustedEvidence.map(({ id, kind, classification }) => ({
        id,
        kind,
        ...classification,
      })),
      { id: "response-schema", kind: "schema", ...request.responseSchemaClassification },
      ...request.tools.map(({ capabilityId, classification }) => ({
        id: capabilityId,
        kind: "tool",
        ...classification,
      })),
    ],
  };
}

function authorityDigest(context: Context): string {
  const retained = {
    siteId: context.siteId,
    run: {
      id: context.run.id,
      state: context.run.state,
      attempt: context.run.attempt,
      leaseUntil: context.run.leaseUntil,
      admissionFingerprint: context.run.admissionFingerprint,
      deadlineAt: context.run.deadlineAt,
    },
    principal: context.evidence.principal,
    version: context.evidence.version,
    definition: context.evidence.definition,
    policy: context.policy,
    settings: context.settings,
    limits: context.limits,
    connection: context.connection,
    connectionSnapshot: context.connectionSnapshot,
    pricing: context.pricing,
  };
  // These are server-owned database rows; dates participate as exact UTC values.
  const dates = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(dates);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, dates(child)]));
    return value;
  };
  return hash("np.agent-runtime-context-authority.v1", dates(retained));
}

function build(
  context: Context,
  input: Omit<NpAgentRuntimeContextPrepareInputV1, "evidence" | "claim">,
  source: NpAgentRuntimeContextCapabilitySourceV1 | undefined,
  sources: { trusted: Request["trustedContext"]; untrusted: Request["untrustedEvidence"] },
  timeoutSeconds?: number,
): Request {
  const { run, evidence, connection, connectionSnapshot: snapshot, pricing } = context;
  const recipe = evidence.registry.recipes.find(
    (entry) => entry.id === run.recipeId && entry.version === run.recipeVersion,
  );
  if (
    !recipe?.instruction ||
    recipe.task !== "interactive-capability" ||
    !connection ||
    !snapshot ||
    !pricing ||
    !connection.activeSecretVersionId ||
    connection.credentialVersion === null ||
    (run.providerDataClassCeiling !== "public-only" &&
      run.providerDataClassCeiling !== "internal-redacted" &&
      run.providerDataClassCeiling !== "sensitive-approved") ||
    !evidence.definition.model ||
    input.siteId !== context.siteId ||
    input.runId !== run.id
  )
    unavailable();
  const instructionDigest = `cj1:sha256:${createHash("sha256").update(recipe.instruction.text, "utf8").digest("base64url")}`;
  const responseSchemaDigest = hash("np.agent-runtime-schema.v1", recipe.responseSchema);
  if (
    instructionDigest !== recipe.instruction.digest ||
    instructionDigest !== run.instructionDigest ||
    responseSchemaDigest !== run.responseSchemaDigest
  )
    unavailable();
  const tools: Request["tools"] = [];
  const entries = source?.list(context) ?? [];
  if (!Array.isArray(entries) || entries.length > 21) unavailable();
  const seen = new Set<string>();
  for (const entry of entries) {
    const canonical = npRequireAgentCapabilityRegistryCanonical({
      schemaVersion: "np.agent-capability-registry.v1",
      projection: "definition",
      capabilities: [entry.canonical],
    });
    const descriptor = canonical.capabilities[0].descriptor;
    const bytes = buildAgentCanonicalFoundationBytes("np.agent-capability-registry.v1", canonical);
    const fingerprint = `cj1:sha256:${createHash("sha256").update(bytes.domainSeparatedUtf8).digest("base64url")}`;
    if (fingerprint !== entry.capabilityFingerprint || seen.has(descriptor.id)) unavailable();
    seen.add(descriptor.id);
    if (
      !recipe.capabilityIds.includes(descriptor.id) ||
      !context.policy.effective.capabilityModes.some(
        (mode) => mode.capabilityId === descriptor.id,
      ) ||
      !descriptor.requiredScopes.every((scope) => evidence.definition.scopes.includes(scope))
    )
      continue;
    tools.push({
      capabilityId: descriptor.id,
      descriptorFingerprint: fingerprint,
      inputSchema: descriptor.inputSchema,
      classification: classification(fingerprint, "internal-redacted"),
    });
  }
  tools.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  const trustedContext: Request["trustedContext"] = context.policy.instructions.flatMap(
    (text, index) => {
      if (text === "") return [];
      const digest = hash("np.agent-runtime-policy-text.v1", text);
      return [
        {
          id: `policy-${index.toString().padStart(3, "0")}`,
          kind: "policy",
          digest,
          classification: classification(digest, "sensitive-approved"),
          text: redactText(text),
        },
      ];
    },
  );
  trustedContext.push(...sources.trusted);
  trustedContext.sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
  );
  const remaining = Math.floor((run.deadlineAt.getTime() - context.now.getTime()) / 1_000);
  const leaseRemaining = run.leaseUntil
    ? Math.floor((run.leaseUntil.getTime() - context.now.getTime()) / 1_000)
    : remaining;
  const timeout =
    timeoutSeconds ??
    Math.min(remaining - 1, leaseRemaining - 1, context.limits.maxWallClockSeconds, 60);
  if (
    remaining < 1 ||
    timeout < 1 ||
    timeout > remaining ||
    timeout > leaseRemaining ||
    timeout > context.limits.maxWallClockSeconds
  )
    unavailable();
  const request: Request = {
    schemaVersion: "np.agent-provider-request.v1",
    siteId: input.siteId,
    runId: input.runId,
    providerCallId: input.providerCallId,
    sequence: input.sequence,
    retryOfId: input.retryOfId,
    idempotencyKey: input.idempotencyKey,
    connection: {
      id: connection.id,
      configSnapshotId: snapshot.id,
      configVersion: snapshot.version,
      configHash: snapshot.configHash,
      secretVersionId: connection.activeSecretVersionId,
      credentialVersion: connection.credentialVersion,
      adapterId: snapshot.adapterId,
      adapterContractVersion: snapshot.adapterContractVersion,
      adapterFingerprint: snapshot.adapterFingerprint,
    },
    provider: connection.provider,
    model: evidence.definition.model,
    recipe: { id: recipe.id, version: recipe.version, fingerprint: run.recipeFingerprint! },
    task: recipe.task,
    instruction: { ...recipe.instruction, classification: classification(instructionDigest) },
    trustedContext,
    untrustedEvidence: sources.untrusted,
    classificationManifestDigest: instructionDigest,
    responseSchema: recipe.responseSchema,
    responseSchemaDigest,
    responseSchemaClassification: classification(responseSchemaDigest),
    tools,
    limits: {
      maxInputTokens: context.limits.maxInputTokens,
      maxOutputTokens: context.limits.maxOutputTokens,
      timeoutSeconds: timeout,
    },
    pricing,
    dataClass: "internal-redacted",
    dataClassCeiling: run.providerDataClassCeiling,
  };
  for (const source of [...trustedContext, ...sources.untrusted])
    if (
      npAgentProviderDataClassRank[source.classification.dataClass] >
      npAgentProviderDataClassRank[request.dataClass]
    )
      request.dataClass = source.classification.dataClass;
  if (
    npAgentProviderDataClassRank[request.dataClass] >
    npAgentProviderDataClassRank[context.policy.effective.providerDataMaximum]
  )
    unavailable();
  request.classificationManifestDigest = hash(
    "np.agent-runtime-classification-manifest.v1",
    npBuildAgentRuntimeClassificationManifestV1(request),
  );
  return npRequireAgentProviderRequestCanonical(request);
}

async function readSources(
  context: NpAgentRuntimeRunContextV1,
  requests: readonly NpAgentEvidenceRequest[],
  reader: NpAgentRuntimeDocumentEvidenceReaderV1 | undefined,
  sequence: number,
  capturedAt: string,
  capabilities: NpAgentRuntimeContextCapabilitySourceV1 | undefined,
): Promise<{ trusted: Request["trustedContext"]; untrusted: Request["untrustedEvidence"] }> {
  const trusted: Request["trustedContext"] = [];
  const untrusted: Request["untrustedEvidence"] = [];
  for (const [index, request] of requests.entries()) {
    const id = `evidence-${index.toString().padStart(3, "0")}`;
    if (request.kind === "run") {
      if (request.runId !== context.run.id || request.projection === "checks") unavailable();
      if (request.projection === "actions") {
        if (!capabilities?.actionOutcomes) unavailable();
        const outcomes = await capabilities.actionOutcomes(context);
        if (!Array.isArray(outcomes) || outcomes.length > 32) unavailable();
        const facts = outcomes.map((outcome) => {
          if (
            outcome.state !== "succeeded" ||
            outcome.safeCode !== null ||
            !context.policy.effective.capabilityModes.some(
              (entry) => entry.capabilityId === outcome.capabilityId,
            )
          )
            unavailable();
          return {
            capabilityId: outcome.capabilityId,
            state: outcome.state,
            safeCode: outcome.safeCode,
          };
        });
        const digest = hash("np.agent-runtime-action-outcomes.v1", facts);
        trusted.push({
          id,
          kind: "server-fact",
          digest,
          classification: classification(digest),
          text: serializeAgentCanonicalJson(facts),
        });
        continue;
      }
      const facts = {
        origin: context.run.origin,
        state: context.run.state,
        queuedAt: context.run.queuedAt.toISOString(),
        startedAt: context.run.startedAt?.toISOString() ?? null,
        finishedAt: context.run.finishedAt?.toISOString() ?? null,
      };
      const digest = hash("np.agent-runtime-run-facts.v1", facts);
      trusted.push({
        id,
        kind: "server-fact",
        digest,
        classification: classification(digest),
        text: serializeAgentCanonicalJson(facts),
      });
      continue;
    }
    if (request.kind !== "document" || !reader || !npIsAgentRuntimeDocumentEvidenceReaderV1(reader))
      unavailable();
    // No field classification declaration exists yet. Redaction/omission never lowers
    // a document source's conservative class, even when it is publicly readable.
    if (
      context.policy.effective.providerDataMaximum !== "sensitive-approved" ||
      context.run.providerDataClassCeiling !== "sensitive-approved"
    )
      unavailable();
    const output = await reader.read(context, request);
    const parsed =
      request.projection === "schema"
        ? npRequireAgentReadCapabilityOutputV1("schema.get", output)
        : npRequireAgentReadCapabilityOutputV1("content.query", output);
    const digest = hash("np.agent-runtime-document-evidence.v1", { request, output: parsed });
    let text: string;
    let observedAt = capturedAt;
    if (parsed.schemaVersion === "np.agent-schema-resource.v1") {
      text = serializeAgentCanonicalJson(parsed.schema);
    } else {
      const document = parsed.items[0];
      if (
        !document ||
        parsed.items.length !== 1 ||
        document.id !== request.documentId ||
        parsed.collection !== request.collection
      )
        unavailable();
      observedAt = document.updatedAt;
      // Local identity/digests/versions are adapter-control facts, never prompt text.
      text = serializeAgentCanonicalJson({
        status: document.status,
        locale: document.locale,
        updatedAt: document.updatedAt,
        text:
          request.projection === "bounded-text"
            ? reader.projectText(request.collection, document.data)
            : "",
      });
    }
    untrusted.push({
      id,
      kind: "content",
      digest,
      observedAt,
      classification: classification(digest, "sensitive-approved"),
      text: redactText(text),
    });
  }
  if (sequence > 1) {
    const calls = await context.db
      .select()
      .from(npAgentProviderCalls)
      .where(
        and(
          eq(npAgentProviderCalls.siteId, context.siteId),
          eq(npAgentProviderCalls.runId, context.run.id),
          eq(npAgentProviderCalls.state, "succeeded"),
          lt(npAgentProviderCalls.sequence, sequence),
        ),
      )
      .orderBy(asc(npAgentProviderCalls.sequence))
      .limit(65);
    if (calls.length > 64) unavailable();
    for (const call of calls) {
      const output = await npRequireAgentRuntimeProviderDecisionV1(call);
      if (output.task !== "interactive-capability") unavailable();
      const decision = output.decision;
      // Prior model text and arguments never become trusted facts or authority.
      const metadata =
        decision.kind === "propose-capability"
          ? { kind: decision.kind, capabilityId: decision.capabilityId }
          : decision.kind === "request-evidence"
            ? { kind: decision.kind, resourceKind: decision.resource.kind }
            : { kind: decision.kind };
      const digest = hash("np.agent-runtime-prior-decision.v1", {
        responseDigest: call.responseDigest,
        metadata,
      });
      untrusted.push({
        id: `prior-decision-${call.sequence.toString().padStart(3, "0")}`,
        kind: "content",
        digest,
        observedAt: call.finishedAt!.toISOString(),
        classification: classification(digest),
        text: serializeAgentCanonicalJson(metadata),
      });
    }
    const outcomes = (await capabilities?.actionOutcomes?.(context)) ?? [];
    if (!Array.isArray(outcomes) || outcomes.length > 32) unavailable();
    for (const [index, outcome] of outcomes.entries()) {
      if (
        outcome.state !== "succeeded" ||
        outcome.safeCode !== null ||
        !context.policy.effective.capabilityModes.some(
          (entry) => entry.capabilityId === outcome.capabilityId,
        )
      )
        unavailable();
      const facts = {
        capabilityId: outcome.capabilityId,
        state: outcome.state,
        safeCode: outcome.safeCode,
      };
      const digest = hash("np.agent-runtime-action-outcome.v1", facts);
      trusted.push({
        id: `action-outcome-${index.toString().padStart(3, "0")}`,
        kind: "server-fact",
        digest,
        classification: classification(digest),
        text: serializeAgentCanonicalJson(facts),
      });
    }
  }
  untrusted.sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
  );
  return { trusted, untrusted };
}

/** Explicit process-local source preparation; no persisted prompt or provider call. */
export function createAgentRuntimeContextV1(
  options: NpAgentRuntimeContextOptionsV1,
): NpAgentRuntimeContextV1 {
  const attestations = new Map<
    string,
    {
      request: string;
      authority: string;
      expiresAt: number;
      evidence: NpAgentEvidenceRequest[];
      capturedAt: string;
    }
  >();
  let disposed = false;
  return {
    async prepare(input) {
      if (disposed || (input.evidence?.length ?? 0) > 32) unavailable();
      const evidence = (input.evidence ?? []).map(npRequireAgentEvidenceRequestV1);
      if (
        new Set(evidence.map((entry) => serializeAgentCanonicalJson(entry))).size !==
        evidence.length
      )
        unavailable();
      return options.admission
        .withCurrentRun(
          {
            siteId: input.siteId,
            runId: input.runId,
            ...(input.claim ? { claim: input.claim } : {}),
          },
          async (context) => {
            for (const [id, value] of attestations)
              if (value.expiresAt <= context.now.getTime()) attestations.delete(id);
            if (attestations.size >= 1_024 && !attestations.has(input.providerCallId))
              unavailable();
            const capturedAt = context.now.toISOString();
            const sources = await readSources(
              context,
              evidence,
              options.documentEvidence,
              input.sequence,
              capturedAt,
              options.capabilities,
            );
            const request = build(context, input, options.capabilities, sources);
            const attestation = {
              request: hash("np.agent-runtime-context-request.v1", request),
              authority: authorityDigest(context),
              expiresAt: context.run.deadlineAt.getTime(),
              evidence,
              capturedAt,
            };
            const prior = attestations.get(request.providerCallId);
            if (prior && prior.request !== attestation.request) unavailable();
            attestations.set(request.providerCallId, attestation);
            return request;
          },
        )
        .catch((error: unknown) => {
          if (error instanceof NpAgentGatewayError) throw error;
          return unavailable();
        });
    },
    async verifyRequest(context, request, transaction) {
      try {
        if (disposed) return false;
        const attestation = attestations.get(request.providerCallId);
        if (
          !attestation ||
          attestation.expiresAt <= context.now.getTime() ||
          attestation.authority !== authorityDigest(context) ||
          attestation.request !== hash("np.agent-runtime-context-request.v1", request)
        )
          return false;
        if ((attestation.evidence.length || request.sequence > 1) && !transaction) return false;
        const sources = transaction
          ? await readSources(
              { ...context, db: transaction.db },
              attestation.evidence,
              options.documentEvidence,
              request.sequence,
              attestation.capturedAt,
              options.capabilities,
            )
          : { trusted: [], untrusted: [] };
        const expected = build(
          context,
          request,
          options.capabilities,
          sources,
          request.limits.timeoutSeconds,
        );
        return hash("np.agent-runtime-context-request.v1", expected) === attestation.request;
      } catch {
        return false;
      }
    },
    forget(providerCallId) {
      attestations.delete(providerCallId);
    },
    dispose() {
      disposed = true;
      attestations.clear();
    },
  };
}
