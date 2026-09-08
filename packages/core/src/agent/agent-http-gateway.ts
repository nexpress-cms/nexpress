import { NpAgentGatewayError } from "./admin-admission.js";
import { npDigestAgentPreviewArtifactContentV1 } from "./preview-artifact-contract.js";
import {
  npRequireAgentHttpCapabilitiesV1,
  npRequireAgentReadCapabilityInvocationResultV1,
  npAgentHttpLimitsV1,
} from "../agent-contract/agent-http-contract.js";
import { npRequireAgentReadCapabilityInvocationRequestV1 } from "../agent-contract/read-capability-contract.js";
import { canonicalBodyUuid } from "../agent-contract/canonical-body-validation.js";
import {
  npRequireAgentActivityRunDetailV1,
  type NpAgentActivityRunDetailV1,
} from "../agent-contract/activity-contract.js";
import type { NpAgentCapabilityAdmissionServiceV1 } from "./capability-admission.js";
import type {
  NpAgentGatewayServiceV1,
  NpAgentAuthenticatedServicePrincipalV1,
} from "./gateway-service.js";

export class NpAgentHttpErrorV1 extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503) {
    super("Agent HTTP request failed.");
  }
}
/** Host-owned shared preview facade: rechecks current site/principal/audience/scopes,
 * every target's visibility, ready/unexpired preview, manifest, bytes/digest/MIME,
 * storage integrity and report parts. No storage, credential or locator escapes. */
export interface NpAgentHttpArtifactFacadeV1 {
  readArtifact(input: {
    authentication: NpAgentAuthenticatedServicePrincipalV1;
    previewId: string;
    artifactId: string;
  }): Promise<
    | {
        kind: "ok";
        bytes: Uint8Array;
        mime: "image/png" | "image/webp" | "application/json";
        contentDigest: string;
        expiresAt: string;
      }
    | { kind: "not_found" }
    | { kind: "authentication_failed" }
    | { kind: "integrity_failure" }
    | { kind: "dependency_unavailable" }
  >;
}
export interface NpAgentHttpGatewayOptionsV1 {
  gateway: NpAgentGatewayServiceV1;
  admission: NpAgentCapabilityAdmissionServiceV1;
  activity?: {
    getMachineRun(input: {
      authentication: NpAgentAuthenticatedServicePrincipalV1;
      runId: string;
    }): Promise<NpAgentActivityRunDetailV1>;
  };
  artifacts?: NpAgentHttpArtifactFacadeV1;
  now?: () => Date;
}
export function createAgentHttpGatewayV1(options: NpAgentHttpGatewayOptionsV1) {
  const now = options.now ?? (() => new Date());
  async function current(authentication: NpAgentAuthenticatedServicePrincipalV1) {
    if (
      authentication.serviceToken.transport !== "agent-http" ||
      authentication.authorizationContext.transport !== "agent-api"
    )
      throw new NpAgentHttpErrorV1(401);
    return options.admission.project({ authentication });
  }
  return {
    async authenticate(input: {
      authorization: string | null;
      requestUrl: string;
      origin?: string | null;
      host?: string | null;
    }): Promise<NpAgentAuthenticatedServicePrincipalV1> {
      const authorization = input.authorization;
      if (
        typeof authorization !== "string" ||
        authorization.length > 256 ||
        !/^Bearer [\x21-\x7e]+$/iu.test(authorization) ||
        authorization.includes(",")
      )
        throw new NpAgentHttpErrorV1(401);
      let authentication: NpAgentAuthenticatedServicePrincipalV1;
      try {
        authentication = await options.gateway.authenticateTransportServiceToken({
          credential: authorization.slice(7),
          transport: "agent-http",
        });
      } catch (error) {
        // This error is emitted only after verifier and persisted authority checks.
        if (error instanceof NpAgentGatewayError && error.code === "GATEWAY_EXPOSURE_DENIED")
          throw new NpAgentHttpErrorV1(404);
        throw new NpAgentHttpErrorV1(401);
      }
      const audience = authentication.serviceToken.audience;
      let url: URL;
      let canonical: URL;
      try {
        url = new URL(input.requestUrl);
        canonical = new URL(audience);
      } catch {
        throw new NpAgentHttpErrorV1(403);
      }
      if (
        url.origin !== canonical.origin ||
        !url.pathname.startsWith("/api/agent/v1/") ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        (input.origin != null && input.origin !== canonical.origin) ||
        (input.host != null && input.host !== canonical.host)
      )
        throw new NpAgentHttpErrorV1(403);
      await current(authentication);
      return authentication;
    },
    async capabilities(authentication: NpAgentAuthenticatedServicePrincipalV1) {
      const projection = await current(authentication);
      return npRequireAgentHttpCapabilitiesV1({
        schemaVersion: "np.agent-http-capabilities.v1",
        capabilities: projection.entries
          .map((e) => e.definition.descriptor)
          .sort((a, b) => a.id.localeCompare(b.id)),
      });
    },
    async invoke(
      authentication: NpAgentAuthenticatedServicePrincipalV1,
      input: unknown,
      abortSignal?: AbortSignal,
    ) {
      let request;
      try {
        request = npRequireAgentReadCapabilityInvocationRequestV1(input);
      } catch {
        throw new NpAgentHttpErrorV1(400);
      }
      const projection = await current(authentication);
      if (!projection.entries.some((e) => e.definition.descriptor.id === request.capabilityId))
        throw new NpAgentHttpErrorV1(404);
      return npRequireAgentReadCapabilityInvocationResultV1(
        await options.admission.invoke({ authentication, request, abortSignal }),
      );
    },
    async getRun(authentication: NpAgentAuthenticatedServicePrincipalV1, runId: string) {
      await current(authentication);
      try {
        canonicalBodyUuid(runId, "runId");
      } catch {
        throw new NpAgentHttpErrorV1(404);
      }
      if (!options.activity) throw new NpAgentHttpErrorV1(404);
      return npRequireAgentActivityRunDetailV1(
        await options.activity.getMachineRun({ authentication, runId }),
      );
    },
    async readArtifact(
      authentication: NpAgentAuthenticatedServicePrincipalV1,
      previewId: string,
      artifactId: string,
    ) {
      await current(authentication);
      try {
        canonicalBodyUuid(previewId, "previewId");
        canonicalBodyUuid(artifactId, "artifactId");
      } catch {
        throw new NpAgentHttpErrorV1(404);
      }
      if (!options.artifacts || !authentication.scopes.includes("changeset:read"))
        throw new NpAgentHttpErrorV1(404);
      const outcome = await options.artifacts.readArtifact({
        authentication,
        previewId,
        artifactId,
      });
      if (outcome.kind !== "ok")
        throw new NpAgentHttpErrorV1(
          outcome.kind === "authentication_failed"
            ? 401
            : outcome.kind === "integrity_failure"
              ? 500
              : outcome.kind === "dependency_unavailable"
                ? 503
                : 404,
        );
      if (
        !(outcome.bytes instanceof Uint8Array) ||
        outcome.bytes.byteLength === 0 ||
        outcome.bytes.byteLength >
          (outcome.mime === "application/json" ? 512 * 1024 : npAgentHttpLimitsV1.artifactBytes) ||
        !["image/png", "image/webp", "application/json"].includes(outcome.mime) ||
        !Number.isFinite(Date.parse(outcome.expiresAt)) ||
        Date.parse(outcome.expiresAt) <= now().getTime()
      )
        throw new NpAgentHttpErrorV1(500);
      // Snapshot host-owned mutable buffers before async authority checks.
      const bytes = new Uint8Array(outcome.bytes);
      const mime = outcome.mime;
      const expiresAt = Date.parse(outcome.expiresAt);
      if (outcome.contentDigest !== npDigestAgentPreviewArtifactContentV1(bytes))
        throw new NpAgentHttpErrorV1(500);
      await current(authentication);
      if (expiresAt <= now().getTime()) throw new NpAgentHttpErrorV1(404);
      return { bytes, mime, contentDigest: outcome.contentDigest };
    },
  };
}
export type NpAgentHttpGatewayV1 = ReturnType<typeof createAgentHttpGatewayV1>;
