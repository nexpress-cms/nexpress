import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { types } from "node:util";
import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npParseBuildJsonV1,
  npParseBuildCandidateTransportJsonV1,
  npRequireAgentBuildCommandOutputV1,
  npRequireAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import type {
  NpSiteBuildGeneratorRetainedArtifactV1,
  NpSiteBuildGeneratorVerificationContextV1,
} from "./generator-controller.js";
import { publishSiteBuildGeneratorAuditV1 } from "./render-artifacts.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

type Kind =
  "baseline-audit" | "candidate-audit" | "final-preview-audit" | "seed-receipt" | "observer-report";
export interface NpSiteBuildGeneratorObservationEvidenceV1 {
  kind: Kind;
  name: string;
  /** Bytes returned by an actual native owner, never authored evidence JSON. */
  bytes: Uint8Array;
  /** Detached producer callback; it must not depend on an object receiver. */
  assertUnchanged(this: void): Promise<void>;
}
type RecordV1 = NpSiteBuildGeneratorRetainedArtifactV1 & {
  kind: "execution-receipt" | "command-output" | "stdout" | "stderr" | Kind;
  sourcePath?: string;
  canonicalDigest?: string;
};
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const fail = (reason: "input" | "path" | "conflict" = "input"): never => {
  throw new SiteBuildError(reason);
};
const same = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.size === b.size &&
  a.nlink === b.nlink &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;
const sameDirectory = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map(
            (key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
          )
          .join(",")}}`
      : JSON.stringify(value);
// Reject getters/proxies before serialization. This only detaches declarations;
// live producer authority must come from the separately required host leases.
function data(value: unknown, depth = 0, budget = { count: 0, bytes: 0 }): void {
  if (++budget.count > 100_000 || depth > 30) fail();
  budget.bytes += typeof value === "string" ? Buffer.byteLength(value) : 8;
  if (budget.bytes > 4 * 1024 * 1024) fail();
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return;
  if (!value || typeof value !== "object" || types.isProxy(value)) fail();
  const array = Array.isArray(value);
  if (array && (value.length > 10_000 || Reflect.ownKeys(value).length !== value.length + 1))
    fail();
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") throw new SiteBuildError("input");
    budget.bytes += Buffer.byteLength(key);
    if (!("value" in descriptors[key])) fail();
    if (array && key === "length") continue;
    if (!descriptors[key].enumerable) fail();
    data(descriptors[key].value, depth + 1, budget);
  }
}
function json(bytes: Uint8Array): unknown {
  return npParseBuildJsonV1(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Stable bounded leaf bytes, with no-follow ancestors and an identity lease. */
async function observe(root: string, relative: string, limit: number) {
  if (
    !/^\.nexpress\/site\/audit\/[A-Za-z0-9._/-]+$/u.test(relative) ||
    relative.length > 240 ||
    relative.split("/").some((part) => part === "." || part === ".." || !part)
  )
    fail("path");
  const directories: Array<{ path: string; identity: BigIntStats }> = [];
  let parent = root;
  for (const part of ["", ...relative.split("/").slice(0, -1)]) {
    if (part) parent = join(parent, part);
    const identity = await lstat(parent, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink()) fail("path");
    directories.push({ path: parent, identity });
  }
  const path = join(root, relative);
  if ((await realpath(dirname(path))) !== dirname(path)) fail("path");
  const checkDirectories = async () => {
    for (const dir of directories)
      if (!sameDirectory(dir.identity, await lstat(dir.path, { bigint: true }))) fail("conflict");
  };
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let identity: BigIntStats;
  let bytes: Buffer;
  try {
    identity = await handle.stat({ bigint: true });
    if (
      !identity.isFile() ||
      identity.nlink !== 1n ||
      identity.size < 0n ||
      identity.size > BigInt(limit)
    )
      fail();
    bytes = Buffer.alloc(Number(identity.size));
    let position = 0;
    while (position < bytes.length) {
      const read = await handle.read(
        bytes,
        position,
        Math.min(65_536, bytes.length - position),
        position,
      );
      if (!read.bytesRead) fail("conflict");
      position += read.bytesRead;
    }
    if (
      !same(identity, await handle.stat({ bigint: true })) ||
      !same(identity, await lstat(path, { bigint: true }))
    )
      fail("conflict");
    await checkDirectories();
  } finally {
    await handle.close();
  }
  const digest = sha(bytes);
  return {
    bytes,
    sha256: digest,
    assertUnchanged: async () => {
      await checkDirectories();
      const current = await observe(root, relative, limit);
      if (current.sha256 !== digest || !same(identity, await lstat(path, { bigint: true })))
        fail("conflict");
    },
  };
}

/** Internal host seam for exact failure-selected audit leaves; no directory discovery. */
export const observeSiteBuildGeneratorAuditFileV1 = observe;

/**
 * Retain actual execution bytes BEFORE private cleanup. This is trusted in-process
 * host composition, not an API accepting JSON as proof. The host must supply the
 * live execution/source/native-owner lease. This owner independently reads only
 * exact receipt-selected command files, checks both raw source profiles, and
 * writes excluded audit artifacts only. It does not publish source or grant
 * execution/commit/deploy authority. Native observation semantics remain their
 * actual producer's responsibility. No directory discovery or foreign-audit read.
 */
export async function retainSiteBuildGeneratorEvidenceV1(input: {
  context: NpSiteBuildGeneratorVerificationContextV1;
  runId: string;
  assertLiveUnchanged(): Promise<void>;
  observations: readonly NpSiteBuildGeneratorObservationEvidenceV1[];
}) {
  if (
    !/^[A-Za-z0-9-]{1,80}$/u.test(input.runId) ||
    typeof input.assertLiveUnchanged !== "function" ||
    !Array.isArray(input.observations) ||
    input.observations.length > 256
  )
    fail();
  const context = input.context;
  data(context.blueprint);
  const blueprint = npRequireAgentSiteBlueprintV1(context.blueprint);
  const blueprintHash = context.blueprintHash,
    originalTreeDigest = context.originalSource.digest,
    candidateTreeDigest = context.candidateSource.digest,
    privateBaselineDigest = context.privateBaseline.digest;
  if ((await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint)) !== blueprintHash)
    fail("conflict");
  data(context.execution);
  const receiptText = JSON.stringify(context.execution);
  if (Buffer.byteLength(receiptText) > 4 * 1024 * 1024) fail();
  const execution = JSON.parse(receiptText) as typeof context.execution;
  if (
    execution.schemaVersion !== "np.site-build-command-execution.v1" ||
    execution.scope !== "private-build-copy" ||
    execution.blueprintHash !== blueprintHash ||
    execution.commandRegistryFingerprint !== blueprint.commandRegistryFingerprint ||
    execution.sourceAfter.digest !== candidateTreeDigest ||
    execution.baselineTreeDigest !== privateBaselineDigest ||
    !Array.isArray(execution.commands) ||
    execution.commands.length > 32 ||
    execution.commands.length !== blueprint.commands.length ||
    !/^\.nexpress\/site\/audit\/command-executor-[A-Za-z0-9-]+$/u.test(execution.auditPath)
  )
    fail("conflict");
  const original = await realpath(context.originalProject),
    project = await realpath(context.project);
  if (
    original !== context.originalProject ||
    project !== context.project ||
    original === project ||
    original === "/" ||
    project === "/"
  )
    fail("path");
  const checkSources = async () => {
    await input.assertLiveUnchanged();
    if (
      (await readSiteSourceTreeV1(original)).digest !== originalTreeDigest ||
      (await readSiteSourceTreeV1(project)).digest !== candidateTreeDigest
    )
      fail("conflict");
  };
  await checkSources();
  const prefix = `.nexpress/site/audit/generator-${input.runId}`;
  const records: RecordV1[] = [],
    artifacts: Array<{ path: string; bytes: Uint8Array }> = [],
    leases = new Set<() => Promise<void>>();
  let total = 0;
  const append = (
    name: string,
    bytes: Uint8Array,
    record: Omit<RecordV1, "path" | "sha256" | "bytes">,
  ) => {
    if ((total += bytes.length) > 252 * 1024 * 1024 || records.length >= 400) fail();
    const path = `${prefix}/${name}`;
    records.push({ ...record, path, sha256: sha(bytes), bytes: bytes.length });
    artifacts.push({ path, bytes });
  };
  const receiptPath = `${execution.auditPath}/receipt.json`;
  const observedReceipt = await observe(project, receiptPath, 4 * 1024 * 1024);
  if (canonical(json(observedReceipt.bytes)) !== canonical(execution)) fail("conflict");
  leases.add(observedReceipt.assertUnchanged);
  append("execution-receipt.json", observedReceipt.bytes, {
    kind: "execution-receipt",
    sourcePath: receiptPath,
  });
  for (const [index, command] of execution.commands.entries()) {
    const planned = blueprint.commands[index];
    const base = `${execution.auditPath}/command-${index}`;
    if (
      command.commandId !== planned.id ||
      command.template !== planned.template ||
      command.exitCode !== 0 ||
      command.outputArtifactPath !== `${base}.output.json`
    )
      fail("conflict");
    const output = await observe(project, command.outputArtifactPath, 768 * 1024);
    const body = npRequireAgentBuildCommandOutputV1(json(output.bytes));
    const canonicalOutput = npBuildCanonicalBytes("np.build-command-output.v1", body);
    if (
      !output.bytes.equals(Buffer.from(canonicalOutput.canonicalJsonUtf8)) ||
      command.outputDigest !== (await npBuildCanonicalDigest("np.build-command-output.v1", body))
    )
      fail("conflict");
    leases.add(output.assertUnchanged);
    append(`command-${index}.output.json`, output.bytes, {
      kind: "command-output",
      sourcePath: command.outputArtifactPath,
      canonicalDigest: command.outputDigest,
    });
    if (command.execution) {
      if (command.execution.id !== `command-${index}` || command.execution.exitCode !== 0)
        fail("conflict");
      for (const stream of ["stdout", "stderr"] as const) {
        const file = command.execution[stream];
        if (
          file.path !== `${base}.${stream}.log` ||
          !Number.isSafeInteger(file.bytes) ||
          file.bytes < 0 ||
          file.bytes > 8 * 1024 * 1024 ||
          !/^[a-f0-9]{64}$/u.test(file.sha256)
        )
          fail("path");
        const raw = await observe(project, file.path, 8 * 1024 * 1024);
        if (raw.bytes.length !== file.bytes || raw.sha256 !== file.sha256) fail("conflict");
        const captured = Buffer.from(body[stream].base64url, "base64url");
        if (
          !raw.bytes.subarray(0, captured.length).equals(captured) ||
          body[stream].truncated !== raw.bytes.length > captured.length
        )
          fail("conflict");
        leases.add(raw.assertUnchanged);
        append(`command-${index}.${stream}.log`, raw.bytes, {
          kind: stream,
          sourcePath: file.path,
        });
      }
    }
  }
  const observedNames = new Set<string>();
  for (const observation of input.observations) {
    if (
      ![
        "baseline-audit",
        "candidate-audit",
        "final-preview-audit",
        "seed-receipt",
        "observer-report",
      ].includes(observation.kind) ||
      !/^[A-Za-z0-9-]{1,64}$/u.test(observation.name) ||
      typeof observation.assertUnchanged !== "function" ||
      types.isProxy(observation.bytes) ||
      (!Buffer.isBuffer(observation.bytes) && !(observation.bytes instanceof Uint8Array)) ||
      types.isSharedArrayBuffer(observation.bytes.buffer) ||
      observation.bytes.byteLength < 1 ||
      observation.bytes.byteLength > 8 * 1024 * 1024
    )
      fail();
    const name = `${observation.kind}-${observation.name}.json`;
    if (observedNames.has(name)) fail();
    observedNames.add(name);
    if (!leases.has(observation.assertUnchanged)) await observation.assertUnchanged();
    const bytes = Buffer.from(observation.bytes);
    // Fixed candidate envelope profile only; command receipts/output/input data
    // above retain their separate 4 MiB/depth-16 owner and canonical constraints.
    npParseBuildCandidateTransportJsonV1(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    leases.add(observation.assertUnchanged);
    append(name, bytes, { kind: observation.kind });
  }
  for (const lease of leases) await lease();
  await checkSources();
  const manifest = {
    schemaVersion: "np.site-build-generator-evidence.v1",
    scope: "retained-artifacts-only",
    blueprintHash,
    originalTreeDigest,
    candidateTreeDigest,
    executionEvidence: "host-live-lease-required",
    files: records,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`),
    manifestPath = `${prefix}/manifest.json`;
  const publication = await publishSiteBuildGeneratorAuditV1({
    project: original,
    artifacts,
    manifest: { path: manifestPath, bytes: manifestBytes },
  });
  for (const lease of leases) await lease();
  await checkSources();
  const retainedArtifacts = [
    ...records.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
    { path: manifestPath, sha256: sha(manifestBytes), bytes: manifestBytes.length },
  ];
  const retainedLeases: Array<() => Promise<void>> = [];
  for (const file of retainedArtifacts) {
    const current = await observe(original, file.path, file.bytes);
    if (current.sha256 !== file.sha256 || current.bytes.length !== file.bytes) fail("conflict");
    retainedLeases.push(current.assertUnchanged);
  }
  return {
    publication,
    manifest: Object.freeze({
      ...manifest,
      files: Object.freeze(records.map((record) => Object.freeze({ ...record }))),
    }),
    retainedArtifacts: Object.freeze(
      retainedArtifacts.map((record) => Object.freeze({ ...record })),
    ),
    /** Retained original artifacts only: valid after private cleanup or source publication. */
    assertUnchanged: async (): Promise<void> => {
      for (const lease of retainedLeases) await lease();
    },
  };
}
