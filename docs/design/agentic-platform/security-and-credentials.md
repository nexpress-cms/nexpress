# Security and credentials

> Status: implementation design. This document proposes future behavior; the
> shipped staff/member session contract remains
> [`authentication.md`](../../authentication.md), rate limiting remains
> [`rate-limiting.md`](../../rate-limiting.md), and remote operations remain
> [`agent-operated-ops.md`](../../agent-operated-ops.md).
> Baseline: `9b1c04e8927e195b8e8e23c7b1261756067ee25f` (2026-07-24).
>
> Parent design: [Agentic Platform](README.md)

The Agentic Platform adds long-lived machine identities, provider credentials,
untrusted model output, and unattended execution to a multi-site CMS. Those
features must not turn public content, a stolen API key, or a compromised model
into production administrator authority.

The central rule is:

> A credential establishes one identity and audience. A scope permits one
> capability family. Policy determines autonomy. Approval authorizes one
> immutable action. None of these can substitute for another.

Guardian is defense in depth over NexPress application events. It complements,
and does not replace, a WAF, IDS, malware scanner, host monitor, or SIEM.

## Security invariants

The following are release-blocking invariants:

1. Provider credentials and NexPress access credentials use separate records,
   issuers, audiences, storage, rotation, and revocation.
2. A credential is bound to exactly one site. There is no cross-site agent
   token, wildcard site, or process-global “AI administrator.”
3. Existing staff `NpCapability` checks remain the authority for humans.
   `NpAgentScope` is a second, narrower machine boundary and never implies a
   staff role.
4. Every model input is bounded and data-classified. Public content, comments,
   plugin output, remote pages, and logs are untrusted evidence, not
   instructions.
5. Every model output is untrusted. Capability id, arguments, target versions,
   scope, site, risk, approval, and idempotency are recomputed by NexPress.
6. Automatic mutation is allowlisted, policy-authorized, quota-admitted,
   audited, and reversible. Sensitive or destructive actions require a human
   approval or are prohibited.
7. No API, MCP resource, log, diagnostic, export, error, provider prompt, or
   Admin response returns a plaintext stored secret.
8. Revocation stops new work immediately at the authoritative database check;
   caches can improve performance but cannot extend authority.
9. Security controls work without a provider. Authentication, authorization,
   rate limiting, deterministic detectors, credential revocation, incident
   persistence, and emergency pause never depend on an LLM.
10. Failure to load a secret, measure a budget, parse a policy, validate a
    tenant, verify an approval, or check a current target version fails closed.

## Assets and threat model

Protected assets include:

- staff/member identities and browser sessions;
- agent and external MCP identities;
- provider and integration credentials;
- site content, media, private/member audiences, and unpublished drafts;
- tenant boundaries and site policy;
- approvals, ChangeSets, ops plans, action idempotency, and rollback handles;
- provider spend, queue capacity, and application availability;
- normalized security evidence, incidents, and audit history.

The threat model assumes:

| Threat actor or failure     | Representative abuse                                                                                  | Required controls                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous attacker          | credential stuffing, route scanning, spam flood, prompt injection in public content, denial-of-wallet | existing proxy limits and lockout, aggregated detectors, untrusted-data boundary, deduplication, budgets                                             |
| Malicious member            | writes instructions for Moderator, evades spam grouping, reports other tenants' ids                   | exact site/visibility reads, text as evidence only, detector diversity, no existence oracle                                                          |
| Compromised staff browser   | creates broad token, approves malicious action, reads incident PII                                    | CSRF and session checks, least-privilege grant UI, recent step-up for sensitive approval, audit and revocation                                       |
| Stolen MCP/API credential   | content scrape, mass drafts, repeated expensive calls                                                 | site/audience/scope binding, short access lifetime, hash-only service keys, per-credential limits, revocation                                        |
| Compromised provider/model  | malicious tool arguments, data exfiltration, false security conclusion                                | no runtime credentials in prompts, capability/policy validation, egress allowlist, human approval, verification                                      |
| Malicious external content  | indirect prompt injection, hidden instructions, poisoned “memory”                                     | typed evidence envelope, provenance, no self-modifying policy or memory                                                                              |
| Vulnerable/malicious plugin | forged event, cross-site data, arbitrary process access                                               | plugin installation remains deployment trust; runtime treats plugin output as untrusted and agents cannot install/enable code                        |
| Provider or network failure | duplicate output, timeout after billing, invalid usage, OAuth replay                                  | immutable call rows, reservations, idempotency, CAS refresh, retry classes, breakers                                                                 |
| Tenant administrator        | attempts to raise deployment limits or access another site                                            | site scope on every query, deployment maxima, no cross-site credentials                                                                              |
| Database/operations insider | reads ciphertext, tampers with approval/action rows                                                   | external key-encryption key, authenticated encryption/AAD, deployment-held approval-integrity MAC key, database access control, optional SIEM export |

NexPress cannot protect a host after arbitrary server code or the database and
its key-encryption key are both compromised. The deployment guide must state
this boundary explicitly. Plugins and application code run inside the trusted
server process; installing arbitrary code is therefore outside agent
authority.

## Trust boundaries

```text
 [staff browser] -- staff session + CSRF --> [Admin / consent / approval]
                                              |
 [external MCP client] -- OAuth/service --> [Agent Gateway]
                                              |
                                              v
 [public/member/plugin/external data] --> [typed untrusted evidence]
                                              |
                                  [capability + policy facade]
                                              |
                                  [Postgres + pg-boss state]
                                              |
                                           [worker]
                                      /       |       \
                             [credential] [provider] [fixed connectors]
                                vault       API       email/Slack/SIEM
```

Trust transitions must be explicit in code:

- transport authentication creates an `NpAgentPrincipal`;
- the principal injects its canonical `siteId`; request arguments do not;
- capability dispatch performs scope and current policy checks;
- the worker leases one credential version from the vault for one provider
  call;
- provider output returns across the boundary as untrusted structured data;
- an executor reparses the action and separately verifies approval;
- connector destinations come from trusted configuration, never model output.

The web process may encrypt a newly submitted provider credential but does not
decrypt it for normal operation. Only the worker/provider facade receives a
short-lived plaintext lease. The Admin client never receives ciphertext,
nonces, encrypted DEKs, token hashes, or OAuth refresh tokens.

## Two distinct authentication relationships

### Relationship A: an external agent calls NexPress

This is authorization **to NexPress**. It covers remote MCP and agent-oriented
HTTP capabilities.

Remote interactive clients use NexPress's built-in OAuth 2.1 authorization
server and authorization code flow with PKCE. NexPress owns the issuer,
Agent Gateway audience, site/scoped grant, consent, token rotation/revocation,
and audit. Its consent screen is authenticated by the existing staff session,
requires CSRF plus the staff capabilities needed to grant the requested site
scopes, and displays the exact site, client, scopes, expiration, and high-risk
exclusions.
The staff login behind that session may itself use a deployment-installed OIDC
identity provider, but the provider does not issue Agent Gateway access or
refresh tokens. An authorized staff identity or arbitrary upstream token claim
cannot bypass NexPress consent and grant persistence.

Required controls:

- authorization-server and protected-resource metadata use one configured
  canonical HTTPS origin;
- NexPress signs short-lived access tokens with a dedicated Agent Gateway
  signing key and publishes its verification keys; staff/member `NP_SECRET`
  tokens cannot cross this boundary;
- v1 access tokens are JWS `ES256` only, carry a required stable `kid`, and are
  verified against the Agent Gateway P-256 signing-key ring/JWKS; `none`,
  symmetric JWT algorithms, unknown algorithms, and unknown/retired keys fail
  closed;
- MCP access tokens are audience-bound to the canonical site MCP resource URI
  `https://<site-host>/api/mcp` and contain the canonical NexPress issuer,
  exact client id, delegated principal subject, canonical site id, explicit
  scope set, grant version, issued/expiry times, and token id;
- the authorization request's exact Agent Gateway resource indicator becomes
  the token audience; a missing, foreign, or multiple unsupported resource is
  rejected;
- refresh tokens are opaque high-entropy credentials stored only as verifier
  hashes; they rotate by compare-and-swap and replay revokes the grant family;
- PKCE uses `S256`; redirect URIs are exact pre-registered HTTPS values except
  for an explicitly registered loopback HTTP URI, with no wildcard,
  prefix-match, fragment, or userinfo;
- state and authorization codes are random, short-lived, single-use, and bound
  to the staff session, client, redirect URI, site, scopes, resource, and PKCE
  challenge;
- Dynamic Client Registration and Client ID Metadata Document fetching are not
  implemented in v1;
- v1 registers only public OAuth clients with PKCE; NexPress does not issue or
  accept an OAuth client secret, and unattended machine automation uses the
  separate hash-only service credential;
- bearer tokens are accepted only in the `Authorization` header, never a query
  string, cookie, MCP argument, log field, or URL;
- staff/member browser JWTs, cookies, and CSRF tokens are not Agent Gateway
  credentials and cannot cross this audience.

The compact JWS header and payload are exact:

```ts
interface NpAgentGatewayAccessTokenHeaderV1 {
  alg: "ES256";
  kid: string;
  typ: "at+jwt";
}

interface NpAgentGatewayAccessTokenClaimsV1 {
  iss: string;
  aud: string;
  sub: string;
  client_id: string;
  site_id: string;
  scope: string;
  grant_id: string;
  grant_version: number;
  principal_version: number;
  iat: number;
  exp: number;
  jti: string;
}
```

`iss` is exactly the resolved site's canonical HTTPS origin advertised as its
authorization server. `aud` is one string—not an array—equal to that site's
canonical `https://<site-host>/api/mcp` resource. `sub` is the delegated
principal id. `scope` is one ASCII space-delimited, sorted unique non-empty
subset of `npAgentScopes`, always including `site:read`; arrays, commas,
duplicates, and unknown scopes fail. Times are integer NumericDate seconds,
`exp > iat`, and `exp - iat <= 600`; only the shared 60-second verification
skew applies. Grant/principal versions are positive integers and must equal
current persisted rows on every request. Client, site, grant, principal,
issuer, audience, and signing key must all be live and mutually consistent.
`jti` is a random, non-empty, bounded identifier used only for trace
correlation and duplicate-mint diagnostics; v1 does not persist or
individually revoke access-token ids. Individual access tokens therefore
expire within ten minutes, while urgent revocation increments or revokes the
authoritative grant/principal version and invalidates every token issued under
it. Unknown/missing/wrong-type header or claim fields, multi-audience, extra
claims, and non-compact/unencrypted JWT forms fail closed.

HTTP authentication accepts exactly one `Authorization` header using the
case-insensitive `Bearer` scheme and one ASCII credential with no comma or
embedded whitespace. OAuth uses the three-segment compact JWS above. Service
credentials use
`npst1_<public-token-id>_<43-character-base64url-secret>` (32 random bytes).
The prefix selects the verifier; an invalid JWT is never retried as a service
token and an invalid service token is never parsed as JWT. A remote token's
stored transport/audience must match `mcp-http`/the MCP resource or
`agent-http`/the Agent API resource exactly. Multiple headers, Basic/custom
schemes, query/cookie/form tokens, padded/noncanonical base64url, oversized
values, or an unknown prefix return `401` without logging the credential.
Stdio alone reads the same opaque service value from its dedicated
environment input and requires a `stdio` audience; no HTTP header is
synthesized.

Every NexPress-minted opaque one-time or rotating verifier uses one closed
wire grammar:

```text
<prefix>_<publicId>_<secret>
```

`publicId` is the canonical lowercase hyphenated UUID named below. `secret` is
exactly 32 cryptographically random bytes encoded as 43 unpadded canonical
base64url characters. The complete ASCII value is bounded to 96 bytes, has no
whitespace/control character, and is parsed by prefix before any row lookup.

| Material                         | Prefix  | Public id / verifier purpose                      |
| -------------------------------- | ------- | ------------------------------------------------- |
| Agent Gateway service credential | `npst1` | service-token row id / `service-token`            |
| Agent Gateway authorization code | `npac1` | authorization-code row id / `authorization-code`  |
| Agent Gateway refresh token      | `nprt1` | refresh row `token_id` UUID / `refresh-token`     |
| OAuth consent challenge          | `npoc1` | authorization-request row id / `oauth-consent`    |
| Provider OAuth setup state       | `npps1` | connection-auth-request row id / `provider-state` |
| Approval decision challenge      | `npap1` | approval row id / `approval-challenge`            |

The keyed verifier is exactly:

```text
HMAC-SHA-256(
  selectedHashKey,
  UTF8("np.agent-opaque-verifier.v1\0" + purpose + "\0" +
       canonicalSiteId + "\0" + publicId + "\0") || secretBytes
)
```

Purpose, canonical site id, and public id cannot contain NUL. Persistence uses
`ov1:hmac-sha256:<key-id>:<base64url-no-padding>` plus the same key id in its
typed column; disagreement fails Doctor. This domain separation makes
cross-kind, cross-row, and cross-site substitution impossible even if two rows
somehow receive the same secret bytes. The parser performs a bounded lookup by
the public id, recomputes once, compares in constant time, and returns the same
safe failure for unknown id, wrong prefix/purpose/site/length/encoding/secret,
or expired/consumed/revoked state. Raw material is never logged.

The initial exported `npAgentOAuthLimits` are exact: authorization
request/consent state 10 minutes, authorization code 5 minutes, access token 10
minutes, refresh-token inactivity 7 days, refresh-family absolute lifetime 30
days, and verification clock skew 60 seconds. Deployment policy may shorten
these values but not lengthen them. Refresh rotation never extends the family
past its absolute expiry.

Local stdio, CI, and unattended machine clients may use a service credential
created explicitly in Agent Studio. It is a random value with a public key id
prefix and at least 256 bits of entropy. The full value is displayed once;
NexPress stores only a versioned keyed hash, metadata, scopes, site, expiry,
transport/audience binding, and revocation state. HTTP clients send it only in
the authorization header. A stdio host reads an explicitly stdio-bound value
from its environment and resolves the same principal internally; that
credential cannot be replayed over HTTP. Both paths have the same capability
and policy checks as OAuth.

Service credentials always expire: the deployment-capped maximum is 90 days
in production/hosted mode and 365 days in development. Rotation may use only a
short, audited overlap. There is no process-global environment token that
silently grants every site. A local environment may hold one site-specific
service credential, but the CLI must read it without printing it or placing it
in process arguments.

The exact shared limits and rotation input are:

```ts
export const npAgentServiceTokenLimits = {
  productionMaxLifetimeSeconds: 90 * 24 * 60 * 60,
  developmentMaxLifetimeSeconds: 365 * 24 * 60 * 60,
  rotationOverlapDefaultSeconds: 15 * 60,
  rotationOverlapMaxSeconds: 60 * 60,
} as const;

interface NpAgentServiceTokenRotateInputV1 {
  schemaVersion: "np.agent-service-token-rotate.v1";
  expectedTokenRowVersion: number;
  overlapSeconds: number;
  idempotencyKey: string;
}
```

`overlapSeconds` is `0..3_600`; deployment policy may lower the default or
maximum, never raise it. The rotation transaction locks the same
site/principal/family `active_head`, verifies the expected row version and
unique predecessor/family generation, creates one replacement, and sets the
old cutoff to
`min(old.expiresAt, now + overlapSeconds)`. Thus
`overlapExpiresAt <= min(old expiry, now + configured maximum)` is an enforced
invariant, not a cleanup convention. `0` revokes the old token when the
replacement activates.

Service credentials, authorization codes, OAuth refresh tokens, consent/setup
state, and approval challenges use the same server-only
`NpAgentTokenHashKeyring` and exact opaque-verifier envelope above. The
keyring has an active dedicated 32-byte key and non-secret key id and may
retain explicitly configured previous keys during a bounded rotation window.
Normal rotation must retain each previous key until every non-revoked verifier
row that names its key id has expired and its replay-detection window has
passed, because a hash-only verifier cannot be re-keyed. Removing one earlier
is an explicit emergency mass revocation: the transaction first revokes every
referenced service token, code/refresh family, setup request, and pending
challenge and emits audit/notification evidence. It is separate from
staff/member `NP_SECRET`, the Agent Gateway signing key, and the vault master
key. Missing key ids, unknown algorithms, or unavailable key material fail
closed.

### Relationship B: NexPress calls a model provider

This is authorization **from NexPress to a provider**. It covers BYOK API keys,
provider project/service credentials, and provider-supported delegated OAuth.

The connection is site-scoped and identifies:

- provider adapter kind and provider account/project hint;
- credential kind and encrypted credential version;
- allowlisted model ids;
- provider data-processing classification;
- same-site active Agent-version references authorized to use it;
- token/cost ceilings and current breaker state;
- expiry, rotation, last successful use, and revocation metadata.

NexPress must not assume that a consumer ChatGPT, Claude, or similar
subscription can be used as an API credential. Only credentials and OAuth
flows officially supported by the selected provider adapter are accepted.
Provider OAuth state and PKCE `S256` verifier are short-lived, single-use,
bound to the adapter/client, staff browser session, exact site, connection,
redirect URI, and requested permission set, and never stored in
browser-readable long-term storage. State is hash-verified; the verifier uses a
temporary vault lease that is destroyed after exchange or expiry.
The setup request/code-sealing window has the shared ten-minute hard maximum;
deployment may shorten it but cannot lengthen it.

The OAuth callback does not start the provider adapter in the web process. It
atomically consumes the setup request and creates the temporary
`provider-oauth-code` secret metadata, vault seal journal, and frozen
`oauth-exchange` operation in `awaiting_secret`, then dispatches seal with the
live code buffer and redirects to a local pending page. The vault reconciler
queues that already-linked operation only after adopting a successful seal
receipt; seal input loss fails it and requires fresh authorization. The worker
then leases the code and PKCE verifier, rechecks adapter/client/config
fingerprints, performs the one exchange, seals/activates the credential, and
destroys both temporary secrets. Provider denial atomically terminalizes the
request with `AUTHORIZATION_DENIED`, journals PKCE destruction, and creates no
code/connection operation. An ambiguous exchange requires fresh authorization
rather than code replay.

The exact route pair is `POST
/api/admin/agents/connections/{id}/oauth/start` plus `GET
/api/agents/provider-oauth/callback/{adapterId}`. Start uses normal Admin
invocation/idempotency authority. Callback accepts only the exact success or
denial query union and uses the consumed `npps1` state row—not an Admin
invocation—as its sole authority. Its safe same-origin `303`, no-store,
query-redaction, staff-session binding, and error behavior are fixed in
[admin-agent-studio.md](admin-agent-studio.md#153-provider-oauth-callback).

The worker leases the current credential immediately before a call. The lease
is not placed in `NpAgentProviderRequest`, model messages, tool definitions,
run state, job payload, or error context. Provider responses cannot request,
rotate, reveal, or select another credential.

The connection-auth boundary is a separate server-only contract from model
inference:

```ts
interface NpAgentProviderOAuthAuthorizeInputV1 {
  schemaVersion: "np.agent-provider-oauth-authorize.v1";
  connection: NpAgentParsedConnectionConfigV1;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  requestedPermissions: string[];
  expiresAt: string;
}

interface NpAgentProviderOAuthAuthorizeOutputV1 {
  schemaVersion: "np.agent-provider-oauth-authorize-result.v1";
  authorizationUrl: string;
}

interface NpAgentProviderOAuthExchangeInputV1 {
  schemaVersion: "np.agent-provider-oauth-exchange.v1";
  connection: NpAgentParsedConnectionConfigV1;
  redirectUri: string;
  requestedPermissions: string[];
  expectedConfigVersion: number;
  expectedConfigHash: string;
}

interface NpAgentProviderOAuthRefreshInputV1 {
  schemaVersion: "np.agent-provider-oauth-refresh.v1";
  connection: NpAgentParsedConnectionConfigV1;
  expectedSecretVersionId: string;
  expectedCredentialVersion: number;
  expectedRefreshGeneration: number;
  requestedPermissions: string[];
}

interface NpAgentProviderOAuthCredentialMaterialV1 {
  schemaVersion: "np.agent-provider-oauth-credential.v1";
  tokenType: "Bearer";
  accessToken: Uint8Array;
  refreshToken:
    | {
        mode: "replace";
        token: Uint8Array;
        refreshExpiresAt: string | null;
      }
    | { mode: "retain" }
    | { mode: "none" };
  accessExpiresAt: string;
  grantedPermissions: string[];
  providerSubject: Uint8Array | null;
}

type NpAgentProviderAuthOperationResultV1 =
  | {
      schemaVersion: "np.agent-provider-auth-result.v1";
      status: "succeeded";
      credential: NpAgentProviderOAuthCredentialMaterialV1;
      safeAccountHint: string | null;
      resultDigest: string;
    }
  | {
      schemaVersion: "np.agent-provider-auth-result.v1";
      status: "failed";
      errorClass:
        | "authorization-denied"
        | "invalid-grant"
        | "invalid-client"
        | "permission-mismatch"
        | "subject-mismatch"
        | "transient"
        | "unknown";
      retryable: boolean;
      safeCode: string;
      resultDigest: string;
    };

type NpAgentProviderProbeResultV1 =
  | {
      schemaVersion: "np.agent-provider-probe-result.v1";
      status: "ready";
      providerSubject: Uint8Array;
      grantedPermissions: string[];
      capabilityIds: string[];
      safeCode: null;
      resultDigest: string;
    }
  | {
      schemaVersion: "np.agent-provider-probe-result.v1";
      status: "unauthorized" | "forbidden" | "unavailable";
      providerSubject: Uint8Array | null;
      grantedPermissions: [];
      capabilityIds: [];
      safeCode: string;
      resultDigest: string;
    };

interface NpAgentParsedConnectionConfigV1 {
  schemaVersion: "np.agent-parsed-connection-config.v1";
  connectionId: string;
  adapterId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  configVersion: number;
  configHash: string;
  config: NpAgentJsonObject;
  pricingCatalog: NpAgentModelPricingV1[];
  pricingCatalogFingerprint: string;
}

interface NpAgentConnectionDestinationDescriptorV1 {
  schemaVersion: "np.agent-connection-destination-descriptor.v1";
  kind: "notification";
  adapterId: string;
  descriptor: NpAgentJsonObject;
}

interface NpAgentConnectionAuthAdapter {
  readonly id: string;
  readonly contractVersion: number;
  readonly fingerprint: string;
  readonly credentialEnvelopeVersions: readonly [1];
  readonly supportedConnectionKinds: NpAgentConnectionKind[];
  readonly supportedAuthKinds: Array<"api_key" | "oauth">;
  readonly configSchema: NpAgentJsonSchema;
  readonly destinationDescriptorSchema: NpAgentJsonSchema | null;
  readonly oauth: {
    authorizationOrigins: string[];
    permissionInventory: string[];
    buildAuthorizationUrl(
      input: NpAgentProviderOAuthAuthorizeInputV1,
    ): NpAgentProviderOAuthAuthorizeOutputV1;
    exchangeAuthorizationCode(
      input: NpAgentProviderOAuthExchangeInputV1,
      context: {
        codeLease: NpProviderOAuthCodeLease;
        pkceLease: NpProviderOAuthPkceLease;
        signal: AbortSignal;
      },
    ): Promise<NpAgentProviderAuthOperationResultV1>;
    refreshCredential(
      input: NpAgentProviderOAuthRefreshInputV1,
      context: {
        credentialLease: NpProviderCredentialLease;
        signal: AbortSignal;
      },
    ): Promise<NpAgentProviderAuthOperationResultV1>;
  } | null;
  parseConfig(input: {
    schemaVersion: "np.agent-connection-config-parse.v1";
    connectionId: string;
    configVersion: number;
    config: NpAgentJsonObject;
  }): NpAgentParsedConnectionConfigV1;
  deriveDestinationDescriptor(input: {
    parsedConfig: NpAgentParsedConnectionConfigV1;
  }): NpAgentConnectionDestinationDescriptorV1 | null;
  probeCredential(
    connection: NpAgentParsedConnectionConfigV1,
    context: {
      credentialLease: NpProviderCredentialLease;
      signal: AbortSignal;
    },
  ): Promise<NpAgentProviderProbeResultV1>;
}
```

The frozen `npAgentProviderAdapterLimits` inventory is:

| Value                                        |          v1 maximum |
| -------------------------------------------- | ------------------: |
| adapter/provider/model/pricing/capability id |           128 chars |
| safe account hint                            |           256 chars |
| safe code                                    |      64 ASCII chars |
| authorization origins per adapter            |                  32 |
| permission inventory/request/result items    |                 128 |
| one permission                               |           256 chars |
| capability ids in a probe result             |                 128 |
| API-key bytes                                |              64 KiB |
| access token bytes                           |              64 KiB |
| refresh token bytes                          |              64 KiB |
| provider authorization-code bytes            |               8 KiB |
| provider PKCE verifier                       | 43..128 ASCII bytes |
| provider-subject bytes                       |               4 KiB |
| authorization URL                            |         4,096 chars |
| parsed non-secret config                     |    256 KiB, depth 8 |
| pricing entries per config snapshot          |                 256 |

Arrays are sorted and unique where order has no semantics; byte/string limits
apply before copying, HMAC projection, persistence, or logging. Registration,
config parsing, OAuth exchange/refresh, probe, provider-result normalization,
persistence reads, and Doctor all import this same inventory. A custom adapter
cannot raise it. The host generates a PKCE verifier of exactly 64 characters
from `[A-Za-z0-9_-]`; decoded/leased values still enforce the RFC 7636
`43..128` ASCII unreserved grammar `[A-Za-z0-9._~-]+`. Authorization codes are
opaque bytes after strict URL percent-decoding and API keys are opaque bytes;
both reject empty/oversized input before a copy, CBOR encode, vault call, or
adapter callback.

All shapes are exact and bounded. Permissions are sorted unique members of the
adapter inventory; times are canonical UTC; URLs are HTTPS, contain no
userinfo/fragment, and use one exact predeclared authorization origin.
`parseConfig` is deterministic/pure and returns only the exact parsed
non-secret config plus its sorted immutable pricing catalog. The host
recomputes `pricingCatalogFingerprint`; a mismatch, overlapping model
interval, or model without exactly one currently effective rule fails config
activation. After a successful credential probe, the host HMAC-projects its
mandatory subject bytes. Independently, the adapter's pure
`deriveDestinationDescriptor` receives only the exact parsed non-secret config
shown in its interface; the account-subject digest remains host-only and is
never passed back into adapter code. The adapter result must match its exact
registered descriptor schema, contain no secret or credential, and be at most
16 KiB/depth 6. The host then combines that descriptor with the separately
projected subject and computes
`destinationFingerprint` itself as `cj1:hmac-sha256:<keyId>:<mac>` with purpose
`np.agent-connection-destination.v1` over exact
`{schemaVersion:"np.agent-connection-destination.v1",siteId,connectionId,
adapterId,adapterContractVersion,adapterFingerprint,accountSubjectKeyId,
accountSubjectDigest,destinationDescriptor}`. This dedicated site-unlinkable
destination keyring is separate from all other keys. The active connection
row and each admitted external-notification row persist their exact
descriptor, frozen account/adapter tuple, key id, and MAC; a key remains until
both owner families are outside retention. The immutable connection-config
version row does not own or persist a destination key. Null is allowed only
for a non-notification connection. The adapter never supplies an
authority/dedupe fingerprint, and a low-entropy email/channel/endpoint
descriptor is therefore not recoverable by a bare digest dictionary attack.
The host then constructs the runtime-only
`NpAgentConnectionConfigSnapshotV1` from the parsed config plus that catalog,
account-subject projection, and derived destination; the adapter cannot read a
pre-filled destination or choose the subject. OAuth is non-null exactly when
the adapter advertises `oauth`.
Initial activation uses the active destination-HMAC key. Refresh, reprobe,
candidate-config activation, and credential replacement reuse the
connection's frozen destination key id and CAS the key id/fingerprint together
with the account/config/secret tuple. An explicit Admin rekey is treated as a
destination change and suppresses old queued notifications; routine key
rotation cannot silently rewrite them.
`buildAuthorizationUrl` is pure and performs no network/credential operation,
so the web process may call it after validating the setup row. Exchange,
refresh, and probe are worker-only. Token/subject byte arrays are single-use
secret material, are sealed or HMAC-projected immediately, and are zeroized in
`finally`; they never enter result/audit/log/Admin rows.

Authorization-code exchange permits refresh mode `replace` or `none` and
rejects `retain`, because there is no prior provider refresh token. Runtime
refresh requires a current refresh-bearing credential: `replace` seals the new
bytes/expiry, `retain` reuses the leased prior bytes and prior expiry in the
new credential version, and `none` explicitly creates an access-only version.
All three increment refresh generation; `none` forces fresh authorization
after access expiry. Null is never overloaded to mean retain/absent. A
successful `ready` probe always returns non-null subject bytes. The host
HMAC-projects them; if exchange/refresh also returned subject bytes the two
digests must match, otherwise the probe supplies the authoritative initial
digest. No credential activates with a null subject digest.

Account-subject projection is an exact, site-unlinkable authority contract.
The connection freezes `accountSubjectKeyId` at first successful activation.
The digest is
`base64url(HMAC-SHA-256(key, framed("np-agent-account-subject/v1", siteId,
adapterId, providerSubjectBytes)))`, where `framed` is the canonical
unsigned-32-bit-length-prefixed byte concatenation and no text normalization
or re-encoding is applied to the adapter-returned subject bytes. Rotation,
refresh, and re-probe must use the already frozen key id; a replacement
connection uses the current key. The projection keyring is server-only and
separate from vault, opaque-verifier, and actor-bucket keys. A key id cannot be
retired while any non-destroyed credential, live connection snapshot,
admitted provider call, or external notification references it. A missing
referenced key blocks activation, rotation, and delivery and produces a
Doctor error. This retention rule preserves byte-equality checks without
persisting provider subject bytes or silently reprojecting authority.

A success with missing/expired access material, widened permissions, changed
subject, or malformed digest fails closed. `transient` is retryable only when the wrapper
proves no single-use/rotating credential may have been consumed; exchange and
refresh timeouts/crashes after dispatch are ambiguous and never blindly
replayed.

Every enabled v1 model or notification connection kind must have exactly one
registered
`NpAgentConnectionAuthAdapter` with matching id/version/fingerprint and
supported kind/auth kind. API-key activation uses the same
`probeCredential`; OAuth additionally uses the nested exact flow. Test,
rotate, enable, refresh, and destroy operations cannot dispatch against an
adapter that implements only model inference or notification send. Conversely,
provider/notification execution uses the already validated immutable config
snapshot from this lifecycle contract rather than hidden adapter state.

These two relationships never use token exchange or passthrough. In
particular:

- an MCP OAuth token is never sent to a model provider;
- a provider key is never accepted by the Agent Gateway;
- a provider OAuth refresh token never becomes an MCP refresh token;
- a model cannot see or call the endpoint that manages its connection.

Slack/email/webhook/SIEM notification connectors use the notification
connection facet. Cloudflare, Sentry, storage, analytics, and other
collector/operation connectors remain separate existing integration
boundaries until a future Agent contract defines their exact consumer,
authority, idempotency, and result unions; v1 does not create a generic ready
connection for them. None reuse a provider or Agent Gateway token.

## Agent identity and scopes

An `NpAgentPrincipal` contains an immutable principal id, canonical site id,
credential/grant or runtime-run id, exact scopes, authentication method, and
request/correlation id. It contains no staff role. A human staff actor remains
separately recorded when creating, granting, approving, rotating, or revoking
the principal.

The initial exact `NpAgentScope` inventory is:

- `site:read`
- `schema:read`
- `changeset:read`
- `changeset:write`
- `changeset:apply`
- `content:read`
- `content:draft`
- `content:publish`
- `media:read`
- `media:write`
- `navigation:read`
- `navigation:write`
- `theme:read`
- `theme:write`
- `settings:read`
- `settings:write`
- `audit:run`
- `ops:read`
- `ops:plan`
- `ops:execute`
- `incident:read`
- `moderation:execute`
- `security:execute`

There is no `*`, `admin`, `root`, scope prefix matching, or caller-defined
scope. Role templates expand to explicit values when created; adding a future
scope does not retroactively grant it to an existing credential.

The capability mapping is exact:

| Capability                                                    | Required agent scope                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `site.inspect`                                                | `site:read`                                                                                           |
| `schema.get`                                                  | `schema:read` plus resource visibility                                                                |
| `content.query`                                               | `content:read` plus collection/row access                                                             |
| `changeset.create`                                            | `changeset:write` plus the draft/write scope for every operation resource                             |
| `changeset.get`, `changeset.list`                             | `changeset:read`; results filter or reject plans whose resources the principal cannot read            |
| `changeset.validate`, `changeset.preview`                     | `changeset:read` plus read visibility for every operation resource                                    |
| `changeset.schedule`, `changeset.apply`, `changeset.rollback` | `changeset:apply` plus `content:publish` and/or the resource write scopes required by every operation |
| `audit.run`                                                   | `audit:run` plus selected collection/check-family visibility                                          |
| `ops.status`                                                  | `ops:read`                                                                                            |
| `ops.plan`                                                    | `ops:plan` plus the exact allowlisted action                                                          |
| `ops.execute`                                                 | `ops:execute` plus action-specific scopes and approval                                                |
| `incident.get`, `incident.list`                               | `incident:read` plus target visibility/result filtering                                               |
| `moderation.quarantine`, `moderation.restore`                 | `moderation:execute` plus target collection/community policy                                          |
| `security.limitActor`, `security.revokeSessions`              | `security:execute` plus exact actor/impact and enforcement availability                               |

V1 has no plugin-defined agent capability or plugin-invocation scope. Plugin
routes/actions remain inaccessible unless a later reviewed contract adds an
exact extension inventory.

The resource-derived ChangeSet scope inventory is exact:

| Resource family            | Read/inspect                   | Draft/write/apply                                                                      |
| -------------------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| collection documents       | `content:read` plus row policy | `content:draft`; `content:publish` for schedule/apply/rollback                         |
| media and media references | `media:read`                   | `media:read`, plus `media:write` when creating/changing persisted media or a reference |
| navigation                 | `navigation:read`              | `navigation:write`                                                                     |
| theme tokens/settings      | `theme:read`                   | `theme:write`                                                                          |
| registered site settings   | `settings:read`                | `settings:write`                                                                       |

ChangeSet scopes do not tunnel around resource scopes. Validation, preview,
approval display, apply, verification, and rollback re-resolve the complete
operation set against the current effective scopes. Adding an operation or
losing one derived scope invalidates the sealed plan/approval.

Scope is necessary but insufficient. Dispatch also verifies credential status,
agent status, capability source registration, site policy, target
authorization, risk, budget, approval, target version, and idempotency.

Only a current human with the appropriate existing staff capability may create
or widen an agent identity, grant scopes, change autonomy, or rotate a
credential. An agent cannot call those management surfaces, even with
`security:execute` or `ops:execute`.

Every external-principal scope-set change increments its authoritative
`tokenVersion`. Narrowing takes effect immediately because authorization
intersects current principal scopes with the immutable credential/grant
snapshot. Widening does not enlarge existing service tokens, OAuth grants,
refresh families, or issued access tokens; the operator must create a new
service credential or complete fresh OAuth consent for the added scopes.
`revoked` principals cannot resume. The Gateway resume route applies only to a
suspended external principal and revalidates its same-site authority, current
scope set containing `site:read`, and still-live credential/grant without
reviving expired or revoked material. A runtime projection has no Gateway
credential/grant and cannot use that route; it returns to active only within
the Agent paused→active/version-activation transaction after exact
version/status/scope validation.

## Credential vault and envelope encryption

Provider and connector secrets use a server-only vault facade. External Agent
Gateway service credentials are hash-verified and do not need reversible
encryption.

```ts
type NpAgentVaultAlgorithm = "AES-256-GCM" | `custom:${string}`;

type NpAgentConnectionCredentialEnvelopeV1 =
  | {
      schemaVersion: "np.agent-credential-envelope.v1";
      kind: "api_key";
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      secret: Uint8Array;
    }
  | {
      schemaVersion: "np.agent-credential-envelope.v1";
      kind: "oauth";
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      tokenType: "Bearer";
      accessToken: Uint8Array;
      accessExpiresAt: string;
      refresh:
        { mode: "present"; token: Uint8Array; expiresAt: string | null } | { mode: "absent" };
      grantedPermissions: string[];
    };

type NpAgentVaultPlaintextEnvelopeV1 =
  | NpAgentConnectionCredentialEnvelopeV1
  | {
      schemaVersion: "np.agent-credential-envelope.v1";
      kind: "provider_oauth_pkce";
      verifier: Uint8Array;
    }
  | {
      schemaVersion: "np.agent-credential-envelope.v1";
      kind: "provider_oauth_code";
      code: Uint8Array;
    };

interface NpProviderCredentialLease {
  readonly secretVersionId: string;
  readonly envelopeVersion: 1;
  readonly expiresAt: string;
  use<T>(consumer: (credential: NpAgentConnectionCredentialEnvelopeV1) => Promise<T>): Promise<T>;
  dispose(): void;
}

interface NpProviderOAuthCodeLease {
  readonly secretVersionId: string;
  readonly purpose: "provider-oauth-code";
  use<T>(consumer: (code: Uint8Array) => Promise<T>): Promise<T>;
  dispose(): void;
}

interface NpProviderOAuthPkceLease {
  readonly secretVersionId: string;
  readonly purpose: "provider-oauth-pkce";
  use<T>(consumer: (verifier: Uint8Array) => Promise<T>): Promise<T>;
  dispose(): void;
}

interface NpVaultSealRequest {
  schemaVersion: "np.agent-vault-seal.v1";
  aad: NpAgentVaultAadV1;
  plaintext: Uint8Array;
  idempotencyKey: string;
  requestDigest: string;
}

interface NpVaultStoredValueV1 {
  secretRef: string;
  secretVersionId: string;
  aadDigest: string;
  algorithm: NpAgentVaultAlgorithm;
  keyId: string;
  keyVersion: string;
}

type NpVaultSealResultV1 = NpVaultStoredValueV1 & {
  schemaVersion: "np.agent-vault-seal-result.v1";
  status: "sealed" | "already_sealed";
};

type NpVaultRewrapResultV1 = NpVaultStoredValueV1 & {
  schemaVersion: "np.agent-vault-rewrap-result.v1";
  status: "rewrapped" | "already_rewrapped";
};

interface NpVaultOpenRequest {
  schemaVersion: "np.agent-vault-open.v1";
  secretRef: string;
  expectedAad: NpAgentVaultAadV1;
}

interface NpVaultPlaintextLease {
  readonly secretVersionId: string;
  readonly aadDigest: string;
  readonly expiresAt: string;
  use<T>(consumer: (bytes: Uint8Array) => Promise<T>): Promise<T>;
  dispose(): void;
}

interface NpVaultRewrapRequest {
  schemaVersion: "np.agent-vault-rewrap.v1";
  secretRef: string;
  expectedAad: NpAgentVaultAadV1;
  targetKeyId: string;
  targetKeyVersion: string;
  idempotencyKey: string;
  requestDigest: string;
}

interface NpVaultDestroyRequest {
  schemaVersion: "np.agent-vault-destroy.v1";
  secretRef: string;
  expectedAad: NpAgentVaultAadV1;
  idempotencyKey: string;
  requestDigest: string;
}

interface NpVaultDestroyResult {
  schemaVersion: "np.agent-vault-destroy-result.v1";
  status: "destroyed" | "already_absent";
  resultDigest: string;
}

interface NpVaultHealth {
  schemaVersion: "np.agent-vault-health.v1";
  status: "ready" | "degraded" | "unavailable";
  checkedAt: string;
  keyId: string | null;
  safeCodes: string[];
}

interface NpVaultOperationInspectRequestV1 {
  schemaVersion: "np.agent-vault-operation-inspect.v1";
  kind: "seal" | "rewrap" | "destroy";
  idempotencyKey: string;
  requestDigest: string;
}

type NpVaultOperationInspectResultV1 =
  | {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1";
      kind: "seal" | "rewrap" | "destroy";
      state: "pending" | "absent";
      sealed: null;
      destroyed: null;
      safeCode: null;
      resultDigest: string;
    }
  | {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1";
      kind: "seal" | "rewrap" | "destroy";
      state: "failed";
      sealed: null;
      destroyed: null;
      safeCode: string;
      resultDigest: string;
    }
  | {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1";
      kind: "seal";
      state: "succeeded";
      sealed: NpVaultSealResultV1;
      destroyed: null;
      safeCode: null;
      resultDigest: string;
    }
  | {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1";
      kind: "rewrap";
      state: "succeeded";
      sealed: NpVaultRewrapResultV1;
      destroyed: null;
      safeCode: null;
      resultDigest: string;
    }
  | {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1";
      kind: "destroy";
      state: "succeeded";
      sealed: null;
      destroyed: NpVaultDestroyResult;
      safeCode: null;
      resultDigest: string;
    };

interface NpAgentVaultAdapter {
  readonly id: string;
  readonly contractVersion: number;
  readonly fingerprint: string;
  readonly kind: "local-envelope" | `custom:${string}`;
  readonly algorithm: NpAgentVaultAlgorithm;
  seal(input: NpVaultSealRequest, options: { signal: AbortSignal }): Promise<NpVaultSealResultV1>;
  open(input: NpVaultOpenRequest, options: { signal: AbortSignal }): Promise<NpVaultPlaintextLease>;
  rewrap?(
    input: NpVaultRewrapRequest,
    options: { signal: AbortSignal },
  ): Promise<NpVaultRewrapResultV1>;
  destroy(
    input: NpVaultDestroyRequest,
    options: { signal: AbortSignal },
  ): Promise<NpVaultDestroyResult>;
  inspectOperation(
    input: NpVaultOperationInspectRequestV1,
    options: { signal: AbortSignal },
  ): Promise<NpVaultOperationInspectResultV1>;
  healthCheck?(options: { signal: AbortSignal }): Promise<NpVaultHealth>;
  shutdown?(options: { signal: AbortSignal }): void | Promise<void>;
}
```

The frozen `npAgentVaultLimits` inventory is:

| Value                                    | v1 bound                                           |
| ---------------------------------------- | -------------------------------------------------- |
| adapter id                               | 1..128 ASCII identifier characters                 |
| adapter fingerprint                      | 1..256 ASCII characters                            |
| custom kind/algorithm suffix             | `[a-z0-9][a-z0-9._-]{0,63}`                        |
| `secretRef`                              | 1..2,048 characters, no control characters         |
| key id / key version                     | 1..128 ASCII characters each                       |
| idempotency key                          | 1..256 allowed ASCII characters                    |
| request/result digest                    | exact declared prefix plus at most 128 ASCII chars |
| safe code / health safe-code items       | 1..64 ASCII; at most 32 sorted unique items        |
| canonical AAD                            | at most 8 KiB, depth 6                             |
| deterministic-CBOR plaintext envelope    | at most 160 KiB                                    |
| plaintext/open lease                     | at most 5 minutes and one `use()`                  |
| adapter call deadline                    | 60 seconds maximum                                 |
| vault-operation attempt counter          | positive, maximum 65,535                           |
| worker lease                             | 90 seconds maximum                                 |
| retry backoff                            | exact `5,15,30,60,300,900,3600` second ladder      |
| health timestamp / credential timestamps | canonical UTC ISO string, within owning lifetime   |

Registration validates static values; request construction, adapter
result/inspection, persistence read, health/readiness, and Doctor validate
dynamic values with the same constants. An oversized/malformed late result is
not truncated and cannot drive a CAS. Custom adapters cannot raise a bound.
Attempt `n` uses ladder index `min(n-1,6)` with no caller/adapter-selected
delay; deployment may pause but not accelerate it. At 65,535 the row remains
`waiting_inspection`, automatic dispatch stops, and a blocking Doctor issue
requires an implementation/data migration—state is not falsely marked absent
or failed merely to reset the counter. Each call freezes row version/attempt;
a late result after lease loss or another transition cannot drive CAS.

All requests/results are exact and bounded. `NpVaultPlaintextLease` is
server-only, cannot be serialized, exposes bytes only inside a callback, and
expires at the earlier of its declared expiry or the end of one
provider/connector operation. `use()` is single-flight/single-use, always
zeros adapter-owned mutable buffers in `finally`, and rejects after disposal;
callers cannot persist its bytes in a row/result.

Every adapter call receives a host-owned abort signal with a frozen deadline;
registration rejects another signature. Aborting before dispatch yields no
operation. Abort/timeout/shutdown after seal/rewrap/destroy may have reached
the external system and is therefore ambiguous: the row remains non-terminal
and reconciliation calls `inspectOperation` with a new bounded signal before
any permitted redispatch. Abort never proves absence or success. `open`
disposes/zeroizes any late lease, health failure is degraded/unavailable, and
shutdown timeout is reported without allowing a late result to drive state.

Vault plaintext has exactly one canonical purpose-discriminated codec. The
host encodes `NpAgentVaultPlaintextEnvelopeV1` with RFC 8949 deterministic
CBOR: integer map
keys from the framework-owned v1 table, definite lengths, shortest integer
forms, UTF-8 text, byte strings for token/key bytes, and lexicographically
sorted unique permission text. Unknown/duplicate keys, non-canonical bytes,
trailing bytes, another schema/version, or an adapter triple mismatch fail
before an adapter callback. API-key input encodes the `api_key` branch. OAuth
exchange/refresh resolves `replace|retain|none` into the persisted
`present|absent` branch before sealing; `retain` copies only from the old
typed lease inside its callback. PKCE and authorization-code rows use only
their matching one-field temporary branch. Purpose, AAD, material kind, and
decoded branch must agree exactly. The vault sees only canonical bytes.

The v1 integer table and branch membership are frozen:

| Key | Meaning                     | CBOR type                                     |
| --: | --------------------------- | --------------------------------------------- |
|   0 | envelope version            | unsigned integer, exactly `1`                 |
|   1 | kind                        | uint `0=api_key,1=oauth,2=pkce,3=code`        |
|   2 | adapter id                  | UTF-8 text                                    |
|   3 | adapter contract version    | positive uint                                 |
|   4 | adapter fingerprint         | UTF-8 text                                    |
|   5 | API-key secret              | non-empty byte string                         |
|   6 | OAuth token type            | uint, exactly `0` (`Bearer`)                  |
|   7 | OAuth access token          | non-empty byte string                         |
|   8 | OAuth access expiry         | canonical UTC UTF-8 text                      |
|   9 | OAuth refresh mode          | uint `0=present,1=absent`                     |
|  10 | OAuth refresh token         | non-empty byte string                         |
|  11 | OAuth refresh expiry        | canonical UTC text or CBOR null               |
|  12 | granted permissions         | sorted-unique array of UTF-8 text             |
|  13 | PKCE verifier               | byte string satisfying the exact PKCE grammar |
|  14 | provider authorization code | non-empty byte string                         |

The only allowed key sets are API key `{0,1,2,3,4,5}`, OAuth-present
`{0,1,2,3,4,6,7,8,9,10,11,12}`, OAuth-absent
`{0,1,2,3,4,6,7,8,9,12}`, PKCE `{0,1,13}`, and code `{0,1,14}`. Maps use
ascending encoded integer keys; tags, floats, indefinite lengths, extra/null
substitutions, or a key from another branch are invalid. The TypeScript
`schemaVersion` string is represented by key 0's integer and is not duplicated
as text.

Two normative lowercase-hex codec vectors are:

```text
api_key {adapterId:"x", contractVersion:1, fingerprint:"f", secret:h'00'}
  a6000101000261780301046166054100

provider_oauth_code {code:h'41'}
  a3000101030e4141
```

Release fixtures add OAuth-present/absent and 43/128-byte PKCE boundary
vectors, then feed the exact CBOR bytes into the vault request-HMAC vector.
Independent encode/decode implementations must reproduce those bytes and
reject every branch/key mutation.

`NpProviderCredentialLease` is a host wrapper over the raw vault lease: it
decodes, validates AAD/material kind/envelope version/adapter compatibility,
exposes the typed branch once, and zeroizes every token/key buffer and encoded
buffer in `finally`. Provider, notification, probe, and refresh adapters never
parse an opaque byte convention. Each connection-adapter registration declares
`credentialEnvelopeVersions: readonly [1]`; another set is a bootstrap error.
The two OAuth temporary wrappers expose only their matching byte field and
reject connection-credential or cross-purpose envelopes; they share the same
single-use and zeroization rules.

Seal accepts only
`sealed|already_sealed`, rewrap only `rewrapped|already_rewrapped`, and inspect
must echo the requested `kind`. A successful seal/rewrap inspection carries
exactly its matching stored-value result; a successful destroy carries exactly
one destroy result. `pending|absent` has null `safeCode`; `failed` has a
non-null stable safe code. Any cross-kind, both-null success, double receipt,
or status mismatch is malformed and cannot drive a database CAS. Adapter calls
must resolve to void where declared; malformed custom adapters fail bootstrap.
`NpVaultDestroyResult.status` is exactly `destroyed` or `already_absent`;
errors, timeouts, malformed results, or an adapter without required destroy
support block credential/site erasure rather than claiming success.

Seal, rewrap, and destroy use one crash-safe admission protocol. The host first
persists the secret-version id and one `np_agent_vault_operations` row, then
calls the exact frozen adapter with a stable key
`seal:<secretVersionId>:<version>`,
`rewrap:<secretVersionId>:<targetKeyId>:<targetKeyVersion>`, or
`destroy:<secretVersionId>:<metadataVersion>` plus the canonical request
digest. Seal's digest binds AAD and a dedicated-key HMAC of plaintext—not a
reversible/plain SHA fingerprint; rewrap/destroy bind the current ref/AAD and
target/version. Same key+digest returns the same receipt/ref, while same key
with a different digest is a conflict.

Every operation freezes `requestDigestKeyId`. `requestDigest` is unpadded
base64url of HMAC-SHA-256 under that dedicated key over u32be-length-framed
bytes, in order: UTF-8 domain `np-agent-vault-operation-request/v1`, canonical
site id, operation kind, vault adapter id, decimal contract version, adapter
fingerprint, secret-version id, idempotency key, canonical AAD bytes, and
canonical operation input. Seal's final input is the complete encoded
`NpAgentVaultPlaintextEnvelopeV1`; rewrap/destroy use the exact persisted
locator/target metadata and no plaintext. The digest keyring is separate from
vault KEKs and other HMAC purposes. Terminal vault-operation receipts and
destroyed secret-version metadata use the dependency-closed retention in
[data-model.md](data-model.md#9-retention): 90 days by default, 30-day
minimum, 365-day maximum. A digest key or frozen adapter implementation cannot
retire until every operation/secret that names it is terminal, all dependent
auth/connection/invocation/deletion rows are gone, and both deadlines have
passed. Cleanup deletes dependent connection/auth rows, then terminal
connection-operation/auth references; it then atomically prunes each destroyed
secret plus all of its terminal vault-operation receipts as the deferrable
foreign-key component defined in the data model. There is no one-sided delete.
Only afterward may it release key/adapter versions. A missing key blocks
replay/reconciliation and raises Doctor.

After timeout/crash, `agent:vaultOperate {siteId, vaultOperationId}` resolves
the frozen adapter and calls `inspectOperation` before any retry. The global
reconciler finds a row whose enqueue was lost. `pending` waits, `succeeded`
CAS-stores the exact ref/receipt, and `failed` records the safe failure.
`absent` permits ordinary redispatch only for rewrap/destroy, because their
request is reconstructable from persisted locator/AAD metadata.

Seal is intentionally different: plaintext is never journaled. The process
that owns a live single-use input buffer commits the operation/pending-secret
rows and immediately dispatches seal before releasing that buffer. It may
redispatch an inspected `absent` result only while that same operation lease
and live buffer remain in the process. After lease/process loss,
`agent:vaultOperate` records `VAULT_SEAL_INPUT_LOST`, revokes the unsealed
pending secret metadata, and requires API-key re-entry or a fresh provider
OAuth authorization; it never replays a consumed exchange or invents
plaintext. A recovered `succeeded` receipt remains adoptable without the
buffer. The adapter must make the stable `secretVersionId` a deterministic
object/operation owner or durably index the key, so a successful seal can
always be rediscovered and destroyed. A production adapter without
idempotency, inspection, and exact destroy cannot pass readiness. Site
deletion enumerates both secret-version and vault-operation rows, including a
receipt recovered after the original database writer crashed.

Adapter id/version/fingerprint is frozen on the secret and operation. The
registry retains that exact implementation for open/inspect/rewrap/destroy
until no row references it. Missing/mismatch fails leases and readiness and
blocks deletion with a Doctor issue; a newer custom adapter never interprets
an old locator under changed semantics.

The built-in database-envelope mode uses:

- one random 256-bit data-encryption key (DEK) per secret version;
- AES-256-GCM with a unique 96-bit nonce;
- a deployment KMS/HSM key-encryption key (KEK) to wrap the DEK;
- authenticated additional data containing schema version, canonical `siteId`,
  connection id, provider/connector kind, purpose/secret type, stable secret
  version id, monotonic secret version, vault adapter id/contract version/
  fingerprint, and AEAD algorithm;
- persisted algorithm, nonce, ciphertext, authentication tag, wrapped DEK,
  KEK id/version, and AAD digest;
- cryptographically secure randomness from the platform runtime.

The KEK is never stored in Postgres or a content backup. Swapping ciphertext,
wrapped DEKs, site ids, connection ids, kinds, or versions causes GCM/AAD
verification to fail before plaintext is returned. Rewrapping for KEK rotation
does not decrypt provider plaintext in application memory.

The canonical AAD object is exact and hashed/stored alongside ciphertext:

```ts
interface NpAgentVaultAadV1 {
  schemaVersion: "np.agent-vault-aad.v1";
  siteId: string;
  connectionId: string;
  connectionKind: NpAgentConnectionKind;
  purpose: NpAgentConnectionSecretPurpose;
  secretVersionId: string;
  secretVersion: number;
  vaultAdapterId: string;
  vaultAdapterContractVersion: number;
  vaultAdapterFingerprint: string;
  credentialEnvelopeVersion: 1;
  algorithm: NpAgentVaultAlgorithm;
}
```

`purpose`, stable `secretVersionId`, monotonic `secretVersion`, exact vault
adapter version/fingerprint, and credential-envelope version are all present:
two purposes, codecs, or adapter contracts at version 1 are not substitutable.
Decrypt reconstructs this object from
authoritative metadata and constant-time compares its digest before opening
the ciphertext. The built-in adapter declares only
`AES-256-GCM`; a custom adapter declares one bounded canonical
`custom:<adapter-algorithm-id>` during bootstrap. The server constructs AAD
from that declaration before sealing, and the returned sealed algorithm must
equal both adapter declaration and AAD. An empty/changed/unknown algorithm or
an adapter returning a different value fails startup or the operation before
metadata is committed.

Proposed runtime modes:

| `NP_AGENT_VAULT_ADAPTER` | Behavior                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `disabled` (default)     | server provider/connector credentials cannot be saved or used                                        |
| `local-envelope`         | explicit development/single-node master key; production and hosted readiness always reject this mode |
| `custom`                 | host-injected KMS/HSM/secret-manager adapter required                                                |

`local-envelope` requires one exact base64-encoded 32-byte
`NP_AGENT_VAULT_MASTER_KEY`. Malformed, missing, extra-long, reused
`NP_SECRET`, or placeholder values fail startup. Environment intent and the
installed adapter must agree. Production and hosted mode require `custom`;
there is no v1 acknowledgement or escape-hatch setting.

Vault metadata may expose provider kind, connection label, status, created
time, expiry, last-use time, credential version, and a non-secret provider
account hint. It never exposes ciphertext internals as a public/Admin contract.
A health check may test KEK availability using a dedicated canary secret; it
must not decrypt a user credential.

### Secret write path

1. Require current staff session, CSRF, site authorization, and step-up where
   configured.
2. Parse the provider-specific credential in a non-logging request body with a
   strict byte limit.
3. Copy it into a short-lived byte buffer and reject unsupported encodings.
4. Seal with site/connection/version AAD.
5. Store ciphertext and metadata transactionally.
6. Zero the mutable plaintext buffer on every reachable success/error path.
7. Return only connection metadata and a successful validation status.

Framework error mappers, access logs, reverse proxies, error reporters, and
request-body capture must exclude these routes and known secret field names.

## Tenant isolation

Tenant safety is enforced at every layer:

- every `np_agent_*` row has canonical `site_id`; unique keys and relationships
  include it where a foreign row could otherwise be attached across sites;
- every durable site job carries exact top-level `siteId` and registers
  `resolveSiteId`;
- Agent Gateway injects the principal's site. A client-supplied `siteId` is
  rejected or must exactly match before schema parsing;
- service methods use `withCurrentSite` for dispatch but still include explicit
  `site_id` predicates; AsyncLocalStorage is not the sole boundary;
- vault AAD, budget counters, breaker keys, trigger fingerprints, cache keys,
  approval digests, idempotency keys, and audit ids all include site;
- provider prompts are assembled from one authorized site after every
  referenced row has been revalidated;
- global schedules enumerate canonical active sites, then enqueue one
  site-stamped job; they do not run a provider in global context;
- cross-site ids fail closed without confirming whether the foreign object,
  incident, agent, connection, or ChangeSet exists.

`security.revokeSessions` is the explicit exception for an existing
authentication principal whose session family has deployment/global effect.
The caller is still authorized from one exact site, the server resolves the
principal and complete impact, Admin displays that impact, and the action is
sensitive, non-reversible, and always human-approved. A model cannot
provide a foreign site id or select individual token material.

Database row-level security may be added by a deployment, but the framework
does not claim RLS as a substitute for application predicates. Tests must
exercise two sites in the same process, database, queue, provider adapter, and
concurrent batch.

Site transfer/export never includes provider/connector secrets, Agent Gateway
credentials, approval challenges, spend history, security events, or audit
history. A separately reviewed configuration export may include redacted agent
templates and policies without ids or credentials.

## Indirect prompt injection

Every externally influenced value is untrusted:

- document, rich-text, block, comment, report, member profile, filename, alt
  text, and metadata;
- request route/query/header/user-agent and authentication error detail;
- plugin hook/action output and plugin-provided labels;
- WAF, Sentry, webhook, remote-page, search, and log evidence;
- previous provider output and provider-generated summaries.

The runtime sends a structured request with distinct fields for:

1. immutable framework system policy and response schema;
2. versioned site policy authored by an authorized human;
3. trusted server-computed state;
4. bounded untrusted evidence with provenance and digest;
5. exact capability descriptors containing no credentials.

It does not concatenate evidence into system instructions, interpolate it into
tool descriptions, or let evidence select a model, provider, capability,
scope, destination, target site, approval, or budget. Markers such as “ignore
previous instructions,” fake tool JSON, Unicode control characters, HTML
comments, encoded text, and model-specific prompt tokens remain ordinary data.

Before provider dispatch:

- parse current content through its live exact schema and audience policy;
- normalize Unicode and reject disallowed control characters;
- cap each item, item count, total bytes, and estimated tokens;
- strip cookies, authorization headers, secrets, signed URLs, raw IPs, email
  addresses where unnecessary, stack locals, and database connection details;
- label provenance, data class, target id, revision/version, and truncation;
- never fetch a URL found inside evidence.

Those labels are not advisory strings. The Runtime applies the closed
per-source classifier registry and maximum-item/minimum-ceiling algorithm in
[agent-runtime-and-guardian.md](agent-runtime-and-guardian.md); caller,
plugin, model, and connection text cannot lower an item's server-derived
class.

After provider dispatch:

- parse exactly one recipe-discriminated `NpAgentProviderTaskOutputV1`;
- reject prose pretending to be an approval or capability result;
- resolve requested evidence through an allowlisted server resource;
- reparse capability arguments independently;
- compute site, target, risk, approval, and idempotency on the server;
- stop the run on repeated, recursive, or scope-increasing requests.

Prompt-injection classification may improve an incident but is not itself a
security boundary. The system remains safe when the model follows every
malicious instruction in the evidence.

## Approval integrity

Approval authorizes one immutable action, not a run, conversation, agent, or
future class of actions.

The server creates a canonical approval statement:

```ts
interface NpAgentApprovalStatementV1 {
  version: "np.agent-approval-statement.v1";
  siteId: string;
  approvalId: string;
  requester:
    | { kind: "principal"; principalId: string; fingerprint: string }
    | { kind: "staff"; userId: string | null; fingerprint: string };
  target:
    | { kind: "changeset"; changeSetId: string; planHash: string }
    | {
        kind: "changeset_rollback";
        changeSetId: string;
        rollbackPlanId: string;
        planHash: string;
      }
    | {
        kind: "action";
        actionId: string;
        runId: string | null;
        agentId: string | null;
        proposalHash: string;
      };
  capabilityId: string;
  capabilityContractVersion: number;
  capabilityFingerprint: string;
  requiredScopes: NpAgentScope[];
  requiredHumanCapabilities: NpCapability[];
  requiredHumanPredicates: Array<"is-super-admin">;
  policyHashes: string[];
  requiresLivePreview: boolean;
  previewId: string | null;
  previewDigest: string | null;
  risk: "reversible" | "sensitive" | "destructive";
  reauthentication:
    | { mode: "none" }
    | {
        mode: "recent";
        maxAgeSeconds: number;
        assurance: "staff-primary";
      };
  createdAt: string;
  expiresAt: string;
}

interface NpAgentApprovalDecisionInputV1 {
  schemaVersion: "np.agent-approval-decision-input.v1";
  expectedApprovalVersion: number;
  statementHash: string;
  challengeGeneration: number;
  challenge: string;
  idempotencyKey: string;
  reason: string | null;
}

interface NpAgentApprovalChallengeRequestV1 {
  schemaVersion: "np.agent-approval-challenge-request.v1";
  purpose: "approve" | "reject" | "revoke";
  expectedApprovalVersion: number;
  statementHash: string;
  idempotencyKey: string;
}

interface NpAgentApprovalChallengeOutputV1 {
  schemaVersion: "np.agent-approval-challenge.v1";
  approvalId: string;
  approvalVersion: number;
  purpose: "approve" | "reject" | "revoke";
  challengeGeneration: number;
  challenge: string;
  reauthentication: NpAgentApprovalStatementV1["reauthentication"];
  expiresAt: string;
}
```

Canonical JSON is SHA-256 hashed, authenticated with HMAC-SHA-256 by the
deployment-held `NpAgentApprovalIntegrityKeyring`, and bound to a random
one-time approval challenge stored as a verifier hash. The row records the
non-secret integrity key id and the exact immutable canonical statement body;
`requiresLivePreview` is false exactly when both preview fields are null.
Admin renders capability, exact target, server-generated diff/plan, risk,
expiry, and side effects from current records. Model rationale is displayed
separately and clearly labelled as untrusted analysis.

`issueApprovalDecisionChallenge()` accepts only the closed challenge request
through the generic Admin
`POST /api/admin/agents/approvals/{id}/decision-challenge` route. It requires
the current same-origin staff session and CSRF, rechecks current authority and
target state, compare-and-swaps `expectedApprovalVersion`, invalidates an
older unconsumed challenge, and returns one five-minute plaintext challenge
bound to approval, purpose, generation, statement, staff user, and Admin
session. Only its keyed verifier is persisted.

The challenge is intent confirmation, not authentication. For `approve`, every
`sensitive` or `destructive` statement requires a successful
`staff-primary` reauthentication in that same Admin session no more than 300
seconds before both challenge issue and decision. Deployment policy may lower
300 seconds; it cannot raise it or downgrade the mode. A reversible statement
defaults to `none`, but the closed Admin-operation descriptor or policy may
raise it to the same recent mode. `reject` and protective human `revoke`
require current session/CSRF/authority plus their fresh challenge but do not
inherit the target's approve-only reauthentication floor.

For `mode:"recent"`, `maxAgeSeconds` is the resolved safe integer `1..300`,
not always the ceiling literal. The approval row, statement/MAC, challenge
output, and decision recheck carry the same byte-equal chosen value; a policy
change requires a new statement/generation rather than reinterpretation.

The generic approve, reject, and revoke routes accept only the closed decision
input above; the route selects the decision from its path and derives the
target from the approval row. It compare-and-swaps the returned approval
version and consumes exactly the matching challenge generation/purpose.
`challenge` is accepted only over the same-origin Admin session and is never
returned to an MCP or provider principal. `reason` is length-bounded and
treated as untrusted text. A later revoke issues a fresh `revoke` challenge;
it cannot reuse the challenge consumed by approval.

Approve/reject append a separate canonical `np.agent-approval-decision.v1`
record containing `statementHash`, decision, immutable non-PII
`deciderFingerprint`, the sorted current human capability set, decision time,
bounded reason, and the server-derived reauthentication fact
(`none`, or one combined session/primary-auth-method fact fingerprint plus
reauthenticated-at time). Its `decisionHash` is persisted with a MAC
over the canonical decision bytes before an approved statement can be
consumed. The exact decision body is retained beside the hash/MAC, including
the sorted decision-time human capability set and actual reauthentication
fact. Decision and execution reparse the retained
statement/decision bodies and constant-time verify both MACs; a missing key,
changed binding, or invalid MAC fails closed and opens a high-severity
integrity incident. Nulling a deleted staff, action, invocation, or run
foreign key never changes these bodies/hashes/MACs.

Revocation never overwrites an earlier approval decision. Human revocation of
a pending or approved-but-unconsumed row consumes a fresh challenge and appends
a separately MAC-bound `np.agent-approval-revocation.v1` record with
`kind:"human"`, current revoker fingerprint, reason code, optional bounded
reason, prior decision hash when present, and time. Automatic authority-loss,
site-deletion, target-invalidation, or emergency integrity-key retirement
reconciliation runs without a browser challenge under the approval-row lock,
uses a closed non-human kind plus deployment-system fingerprint, and MACs the
same revocation shape. The exact revocation body is retained independently of
denormalized lifecycle columns. Expiry is the distinct `expired` state.
Concurrent approve/reject/revoke/consume operations use approval-version/
state compare-and-swap so exactly one transition wins.

The approval-integrity keyring is separate from the database, token verifier
keyring, Agent Gateway signing keys, vault KEK, and `NP_SECRET`. Normal
rotation retains an old key until every approval that names it is terminal and
past execution/audit verification retention. Early removal explicitly
invalidates affected unconsumed approvals and is audited; it is never treated
as a successful verification.

Approval requires:

- a current human staff session and CSRF;
- every sorted `requiredHumanCapabilities` value for that exact action/site at
  decision time; execution recomputes the required set from current target and
  policy and requires it to byte-match the signed statement;
- every sorted `requiredHumanPredicates` value. In v1 the only extra predicate
  is current persisted `is-super-admin`, used for deployment/global session
  families and never inferred from a site role;
- the statement's exact reauthentication rule: recent `staff-primary` within
  the deployment-capped 300-second maximum for every sensitive/destructive
  approval, or any stricter operation/policy floor;
- a compare-and-swap from `pending` to `approved`;
- unchanged statement digest, target `planHash`/`proposalHash`, policy hashes,
  live-preview id/digest when required, capability contract
  version/fingerprint, exact required-scope set, and agent/credential status.

Approval expires, is single-use, and cannot be reused after rejection,
mutation, rollback, or execution. Editing arguments creates a new action and
approval. A provider, internal agent principal, MCP client, email link,
notification webhook, plugin, or bearer token alone cannot approve.

For a direct action linked to a durable run, approval expiry is capped by the
run's immutable deadline. Challenge issue, decision, and approved execution
all recheck that deadline under the same row locks. Reconciliation at the
deadline atomically expires the unconsumed approval and fails the waiting
action/run with `APPROVAL_DEADLINE_EXPIRED`; no later decision or invocation
can revive or transplant it.

The approval decision is the human authorization record; a scheduled worker
does not invent an "executing staff actor." Staff suspension/deletion or a
capability/site-membership loss serializes against approval consumption and,
in the same authority-change transaction, revokes every still-unconsumed
pending/approved decision made or requested by that user. Target-specific
reconciliation then returns an unscheduled sealed ChangeSet to `ready`,
terminalizes a direct action/run, or terminalizes a rollback plan as defined
by their state machines. Already consumed authorization remains immutable
history; scheduled work still rechecks current target, policy, site state, and
all integrity bindings. The original staff creator of a ChangeSet is
attribution, not an execution principal.

`security.revokeSessions` is sensitive and non-reversible and always requires
human approval. Its impact analyzer classifies the selected session family as
`site` or `deployment`. A family with an exact current-site ownership relation
may use the normal site capability set; every staff session family or any
family capable of invalidating another site's session adds
`requiredHumanPredicates:["is-super-admin"]` to the MAC-bound statement and
rechecks it at decision/execution. A current-site `admin.manage` approval alone
cannot revoke deployment-global sessions. `ops.execute` additionally retains the shipped exact
plan/apply mechanics but narrows execution to the Agent Platform's closed v1
subset: `cache.revalidate`, `agent.run.retry`, and `agent.run.cancel`. Retry
creates a linked run and repeats admission; cancel is cooperative only before
the database commit boundary. Restore, migration, storage cutover, plugin
installation/state, queue-global, schema, secret, and destructive database
actions are not made safe merely by wrapping them in this generic approval.

## Egress and data-exfiltration controls

The worker has no generic browser or `fetch(urlFromModel)` capability.

Provider adapters declare fixed HTTPS origins and model endpoints in trusted
deployment code. Site configuration may select among registered origins but
cannot add an arbitrary origin. The shared outbound client:

- rejects credentials in URLs and redirects to another origin;
- applies DNS/IP policy and blocks loopback, link-local, metadata, and private
  ranges unless a deployment-registered local-model adapter explicitly owns
  that exact endpoint;
- revalidates redirects and resolved addresses to resist DNS rebinding;
- sets connect, response, total, and body-size limits;
- uses deployment proxy and CA policy;
- strips internal headers and sends only provider-specific authorization;
- records redacted origin, latency, status class, and provider request id.

Slack/email/SIEM destinations are preconfigured connector records. A model can
request a stable connector action only when a future registered capability
allows it; it never supplies a URL, email recipient, channel, HTTP method,
header, or request template.

Capability schemas reject arbitrary callback URLs, shell fragments, SQL,
filesystem paths, provider credentials, and opaque network payloads. Generated
content may contain links as content data, but the runtime does not follow them
during the action. Signed media/storage URLs are not sent to providers unless
a dedicated, reviewed media-analysis capability defines redaction and expiry.

The sole v1 outbound link-check exception is the ChangeSet preview checker specified
in [changesets-and-approvals.md](changesets-and-approvals.md). Only the
framework preview-verification worker may call it after a sealed plan and
current admitting authority pass. It derives canonical link URLs from rendered
output; a model cannot choose the HTTP method, headers, body, credential,
recipient, redirect policy, limits, or result consumer. Same-site checking is
route-manifest-only; arbitrary external links are syntax-only. The network
client sends one bodyless, credentialless, non-redirecting HEAD only to a
deployment-reviewed, queryless HTTPS-origin allowlist and returns a safe
status/check record—never response content to a model. Provider/runtime
adapters cannot reach this client.

Each provider connection owns an exact `NpAgentProviderDataClass` ceiling:
`public-only`, `internal-redacted`, or `sensitive-approved`. Site/Agent policy
has the same field and may only narrow it; admission takes the explicit
numeric minimum and freezes the resolved class plus connection config
version/hash on the run and every provider call. Private/member content,
incident PII, and raw security evidence are excluded by default. Changing a
connection ceiling or policy is an audited human management action and affects
only future runs.

## Denial-of-wallet and availability

The order of work is deliberate:

```text
authenticate -> rate limit -> bounded parse -> deduplicate -> deterministic
detect -> trigger policy -> budget reserve -> vault lease -> provider call
```

Controls include:

- proxy limits by route and IP plus Agent Gateway limits by site, principal,
  client, capability family, and credential;
- aggregated traffic/auth events rather than one job per request;
- event fingerprints, incident merge, trigger cooldown, and subject cooldown;
- bounded event backlog with deterministic evidence retained before model work;
- site, agent, connection, provider, and deployment concurrency limits;
- provider turns, tool proposals, bytes, tokens, time, and cost per run;
- hourly/daily/monthly integer reservations and hard deployment maxima;
- conservative failure when price or usage cannot be measured;
- pg-boss site job admission for optional agent work;
- circuit breakers for 401, 429, timeout, 5xx, malformed output, repeated
  policy denial, action churn, and spend velocity;
- emergency exact-site pause for provider calls and automatic mutation;
- read-only half-open probes and bounded retries with jitter.

An attacker-controlled trigger cannot override cooldown or mark itself
critical. Critical deterministic security signals may persist and notify when
provider budget is exhausted, but they do not receive an unmetered model call.
Queue saturation must not prevent existing auth lockout, rate limiting, an
already-admitted action's verification/undo, or credential revocation.

`security.limitActor` uses a separate exact restriction adapter shared by the
worker capability and proxy enforcement entrypoint. It persists a canonical
site, opaque actor bucket or authenticated principal, allowlisted route/action
scope, server-capped duration, expiry, incident/action id, and reason code. It
never stores a model-supplied raw IP. The current rate-limiter counter contract
remains unchanged. Automatic limiting is disabled when the restriction adapter
is process-local in a multi-node deployment or cannot prove that every proxy
replica enforces the same state.

Provider usage that arrives after timeout is reconciled if the provider
exposes it; reserved maximum cost is retained until the ambiguity window
expires. Administrators see reserved, reported, estimated, and unpriced usage
separately. “Unknown” never renders as zero and blocks new provider-backed
admission until reconciliation; it is not a token/call-only exception.

## Memory poisoning and feedback safety

The initial runtime has no autonomous free-form long-term memory.

It distinguishes:

- **policy:** human-authored, versioned, schema-validated instructions;
- **run state:** immutable trigger/evidence/action records for one run;
- **case history:** incident timeline and exact prior outcomes;
- **feedback:** exact labels such as `confirmed-spam`, `false-positive`,
  `useful`, or `incorrect`, with human actor and detector/prompt version.

Provider summaries, content, comments, plugin output, and previous decisions
cannot be promoted into policy. Feedback never edits a detector threshold,
system prompt, scope, autonomy, or budget automatically. A tuning process may
produce a reviewed policy/detector proposal with evaluation results; an
authorized human applies a new version.

Retrieval always filters by canonical site, allowed data class, role, current
audience, retention, and provenance. It carries stable ids, version/digest,
source type, and recorded time. Summaries never replace the original exact
action/audit record for authorization or rollback. Deleting or changing source
content invalidates derived retrieval entries.

If a future feature adds semantic memory, it must ship with a separate exact
contract, source citation, poisoning evaluation, deletion propagation, tenant
tests, and an off-by-default policy. A generic vector store is not approved by
this design.

## Audit, retention, and privacy

Audit records are append-only through the application facade and record:

- site, timestamp, correlation id, and stable event type;
- human, agent, service credential, OAuth client, run, and provider connection
  ids where relevant;
- capability and scope decision;
- arguments/action/approval/plan/ChangeSet digests, not secrets;
- policy, target, credential, and capability versions;
- budget reservation and normalized usage;
- server-computed risk, approval actor, execution, verification, undo, and
  final outcome;
- bounded error/reason codes and redacted support metadata.

Audit does not store provider/API keys, OAuth tokens, cookies, CSRF values,
passwords, raw auth headers, plaintext vault values, database URLs, full
prompts by default, or raw request bodies. Existing logger and error-reporter
facades receive redacted structured context; secret-route request capture is
disabled. Automated tests scan logs, job logs, error reports, Admin JSON, and
fixtures for seeded secrets.

The proposed defaults in
[`agent-runtime-and-guardian.md`](agent-runtime-and-guardian.md#retention-and-deletion)
apply. Security audit and approvals retain for 365 days by default; body-level
provider diagnostics retain for at most 30 days and are off by default.
Deployment policy sets hard maximums. V1 has no legal-hold surface; a
deployment that needs one must keep the affected feature disabled or add a
separately reviewed exact hold contract rather than extend retention ad hoc.
Pruning is itself audited and cannot delete active incidents, pending
approvals, incomplete actions, or their required evidence.

Raw IP is used only at the request enforcement boundary where necessary. Agent
events use a rotating, deployment-secret HMAC bucket scoped by site and
purpose; different sites/purposes cannot correlate it. The bucket carries a
non-secret key id, and the dedicated keyring retains prior keys for at least
the maximum detector window and active restriction TTL so rotation cannot
silently disable enforcement. Email, user-agent, path, query, and content
excerpts are minimized or redacted before provider use.
Incident access requires human capability or `incident:read` and remains
site-scoped.

Deleting a site removes its agent/security rows, service grants, restrictions,
ciphertext, and queued work. An external vault adapter must return an exact
confirmed deletion result; unavailable or ambiguous erasure blocks site
deletion instead of orphaning a credential. Member/staff deletion erases
profile data and pseudonymizes retained audit actor references according to the
legal retention policy. Credential/audit data is excluded from portable
content exports. Encrypted backups may contain ciphertext but never the KEK;
restoration into another deployment requires explicit credential re-entry or a
separately governed key recovery procedure.

## Rotation and revocation

### Provider and connector secrets

Secret versions transition:

```text
connection-credential:
  pending -> active | revoked | destroyed
  active -> retiring | revoked
  retiring -> destroyed | revoked
  revoked -> destroyed

provider-oauth-pkce | provider-oauth-code:
  pending -> destroyed
```

Rotation seals a new `pending` version, performs a bounded provider validation,
then atomically marks it `active` and the old version `retiring`. New calls use
only active. Existing calls remain pinned to the version they leased, but a
result received after emergency revocation cannot execute a capability. The
old version may be destroyed after the maximum call duration and audit grace
window.

A failed/cancelled pending connection credential is revoked or destroyed; it
never becomes active later. A PKCE verifier and captured authorization code
are temporary leases and never enter active/retiring/revoked: callback
success, error, cancellation, expiry, or site deletion destroys them. The
worker destroys the code immediately after its single exchange attempt,
whether that attempt succeeds or fails. `activatedAt` is required only after a
connection credential became active, `retiredAt` when it leaves active use,
and `destroyedAt` only after the adapter confirms destruction. Revocation
blocks authority immediately; physical destroy may follow and is the only
transition out of revoked.

Provider OAuth refresh uses compare-and-swap against the current encrypted
refresh-token version. Replay, `invalid_grant`, or subject/account mismatch
opens the connection breaker and requires reauthorization. Access tokens live
only in short-lived worker memory.

Revocation:

1. atomically marks the connection/version revoked and opens its breaker;
2. blocks new leases and provider calls;
3. cancels queued runs using the connection;
4. allows already-admitted verification/undo to converge without another
   provider call;
5. discards late provider proposals as untrusted diagnostics;
6. records and notifies the human actor/reason;
7. requires the adapter's exact `destroyed`/`already_absent` result for the
   stored NexPress secret, without treating that as proof the provider revoked
   its upstream credential.

KEK rotation rewraps DEKs in bounded, restartable batches. Each row retains the
KEK version needed during migration; success is verified before the old KEK is
retired. Ciphertext schema/algorithm migration requires a new secret version,
test vectors, backup/restore drill, and Doctor coverage.

### Agent Gateway credentials

Service credential rotation creates a second key, displays it once, and may
allow a deployment-capped overlap recorded by family/replacement lineage and
an exact old-token cutoff. Revoking either credential id is immediate in the
authoritative row and does not depend on token cache expiry; principal/family
revocation closes all siblings. OAuth access tokens are short-lived and
stateless; grant revocation invalidates the refresh family and every access
token whose embedded grant/principal version is no longer current. V1 has no
individual access-token id denylist.

Revoking an agent identity blocks every credential and enabled trigger under
it. Any principal scope-set change increments `tokenVersion`; narrowing also
intersects immediately with immutable grant/token snapshots, while widening
requires a new snapshot before the added scope can be used. Emergency site
pause blocks all Agent Runtime provider calls and automatic mutations without
disabling normal human CMS access.

Agent Gateway signing keys are separate from `NP_SECRET`, provider secrets,
and vault KEKs. Private keys live in the deployment secret/KMS boundary; only
public verification keys reach OAuth metadata/JWKS. Rotation publishes
`next`, promotes it to `active`, and retains the prior public key as
`retiring` through the maximum access-token lifetime plus allowed clock skew
measured from its last issuance; removing it earlier is an audited emergency
revocation of every still-valid token signed by that key. Every token
has a validated `kid`; unknown, revoked, wrong-algorithm, issuer, or audience
values fail closed. Emergency signing-key compromise revokes the key id and
affected grant/token versions, pauses remote Gateway mutation, rotates the
key, and requires clients to obtain new access tokens. Doctor reports key age,
active/next readiness, and overlap without exposing private material.

`security.revokeSessions` operates on existing NexPress staff/member browser
sessions for one server-resolved principal/session family. It does not revoke
provider or Agent Gateway credentials and is not a replacement for their
dedicated revocation paths.

## Forbidden and approval-only actions

The Agent Runtime and external Agent Gateway never receive capabilities for:

- arbitrary shell, process, package-manager, Git, or filesystem execution;
- arbitrary SQL, database console, schema generation, or migration authoring;
- production database drop, site deletion, backup deletion, or restore apply;
- reading, revealing, exporting, copying, or changing plaintext secrets;
- creating/widening its own identity, scopes, autonomy, budget, provider
  connection, site policy, detector, or capability;
- approving its own or another action;
- deleting or shortening active audit/security evidence;
- installing, updating, enabling, disabling, or executing arbitrary plugins;
- arbitrary network requests, webhook destinations, DNS, or email recipients;
- changing WAF/IDS/SIEM rules in the initial release;
- permanent IP/account bans, permanent member deletion, or bulk destructive
  moderation;
- bypassing validation, revisions, audience policy, rate limiting, quota,
  ChangeSet, ops plan/apply, or verification.

Some actions remain available to humans through current CLI/Admin workflows,
but are outside the agent capability registry. `ops.execute` is an exact
allowlist, not a bridge to arbitrary CLI commands. Generic human approval does
not expand that allowlist.

Automatic actions are initially limited to:

- draft ChangeSet preparation;
- reversible spam quarantine under a high-confidence deterministic policy;
- short actor rate restriction with exact maximum duration and expiry;
- explicitly safe idempotent retry/verification continuations.

`changeset.apply`, `changeset.rollback`, `moderation.restore`,
`security.revokeSessions`, and `ops.execute` use the capability's locked risk
and approval defaults; site policy may require more approval, never less than
the deployment minimum for sensitive/destructive risk.

## Security incident recovery

Every recovery begins with preserving exact audit/evidence, pausing new
authority, and using deterministic controls. A provider is optional.

| Incident                         | Immediate containment                                                                        | Recovery and verification                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Provider key exposed             | revoke connection/version, open breaker, cancel queued provider runs, rotate at provider     | inspect provider usage and NexPress calls; reauthorize; verify old key fails; re-enable agents explicitly                              |
| Agent Gateway key/token exposed  | revoke key/grant family and agent triggers; rate-limit principal/client                      | inspect scoped activity and actions; rollback reversible changes; rotate; verify stale grant/principal versions fail                   |
| Prompt-injection success/attempt | pause affected agent automatic writes; preserve evidence and prompt/decision digests         | review any actions, rollback/quarantine as appropriate, add regression fixture, version policy/detector before re-enable               |
| Compromised or malicious model   | open provider/agent breaker; discard late proposals; keep deterministic controls running     | change connection/model, replay evaluation corpus in read-only mode, require human re-enable                                           |
| Runaway spend                    | exact-site provider pause and connection breaker                                             | reconcile reservations/provider invoices, fix trigger/dedup policy, lower maxima, half-open one read-only probe                        |
| Unauthorized capability action   | emergency agent pause, revoke credential, block action continuation except verification/undo | verify approval/action digests, inspect audit and idempotency, rollback, rotate credentials, notify affected operators                 |
| Suspected cross-tenant exposure  | pause each affected exact site, revoke affected grants, preserve database/provider evidence  | determine exact rows/prompts/provider ids, notify under deployment policy, patch predicates/AAD, add two-site regression before resume |
| Vault/KMS unavailable            | fail new secret writes/leases closed; keep deterministic detection and human CMS running     | restore KMS, validate canary/AAD, reconcile pending runs; never fall back to plaintext                                                 |
| Vault ciphertext tampering       | quarantine connection and open critical incident                                             | restore validated ciphertext metadata from backup or re-enter secret; rotate KEK/credential if exposure is possible                    |
| Approval replay/tamper           | reject CAS/digest mismatch, pause action, open agent-abuse signal                            | inspect staff session and audit, revoke compromised session/grant, create a fresh plan/action only after review                        |

Emergency controls must be available from local authenticated operations even
when provider, MCP, worker, or Admin JavaScript is unavailable. Recovery steps
that mutate production retain the shipped plan/apply and audit controls.

The exact recovery surface extends the shipped local-first ops CLI:

```text
nexpress agent runtime status --site <siteId> --json
nexpress agent runtime pause  --site <siteId> --reason <text> --execute --json
nexpress agent runtime resume --site <siteId> --plan <artifact> --execute --approve <planId> --json
```

It runs beside the project with the same explicit environment/direct-database
deployment authority as the existing `nexpress ops` commands; that local
process boundary and database credential are the authentication boundary, not
a provider, MCP token, worker, browser session, or hidden HTTP endpoint. The
CLI requires one exact site, resolves a configured non-PII deployment-authority
fingerprint for audit, uses the shared runtime-setting service and per-site
lock, and never accepts a secret in argv. Pause is an immediate idempotent
containment with a required reason. Resume first writes a persisted,
hash-bound readiness plan, requires the shipped `--execute --approve` ceremony,
and fails if Doctor, policy, budget, vault, integrity-key, or worker readiness
is blocking. All commands emit one bounded `np.agent-runtime-ops.v1` result;
there is no all-site wildcard. A deployment-wide incident runbook enumerates
the authoritative site registry and invokes/records this exact operation for
each affected site; partial progress remains explicit.

## Security test and release gates

No server-side agent mutation ships until all applicable gates pass.

### Exact contract and parser tests

- accept every valid event, signal, incident, provider, credential metadata,
  scope, policy, approval, and audit fixture;
- reject unknown keys, missing fields, alternate ids, Unicode edge cases,
  unsafe integers, excessive arrays/depth/bytes, and non-canonical times/sites;
- fuzz parsers and canonical JSON/digest generation;
- prove client-safe entries do not import server, crypto key, DB, provider SDK,
  or Node-only secret code.

### Tenant and authorization integration tests

- two sites share DB, queue, process, provider adapter, model id, and similarly
  shaped object ids without cross-read, prompt, action, budget, incident,
  approval, vault, cache, or audit leakage;
- forged `siteId`, foreign target/connection/incident/ChangeSet, and job payload
  fail before provider or capability dispatch;
- every capability/scope pair has allow and deny tests;
- existing staff roles cannot mint scopes they do not have authority to grant;
- revocation and scope reduction win against concurrent dispatch.

### OAuth and service credential tests

- PKCE `S256`, exact redirect, state/session/site binding, access audience,
  expiry, refresh rotation, replay-family revocation, and consent denial;
- browser staff/member cookies and Agent Gateway tokens cannot cross audiences;
- token/query logging is absent;
- service credentials are random, one-time display, hash-only at rest,
  expiration-enforced, rate-limited, rotatable, and immediately revocable.

### Vault and cryptography tests

- published AES-GCM vectors plus round-trip for every supported secret size;
- nonce uniqueness and secure-random failure behavior;
- ciphertext, tag, nonce, wrapped-DEK, AAD, site, connection, kind, and version
  swap all fail closed;
- KEK rewrap is crash-safe, resumable, and leaves no plaintext persistence;
- backup/restore without KEK cannot decrypt;
- seeded secrets never appear in logs, job logs, errors, traces, snapshots,
  Admin/OpenAPI/MCP responses, provider prompt, or test artifacts;
- custom adapter throw, rejection, malformed destroy result, timeout, and
  shutdown containment.

### Prompt-injection and exfiltration evaluation

- multilingual direct/indirect injection in comments, rich text, block props,
  filenames, HTML comments, encoded text, tool-shaped JSON, logs, WAF events,
  plugin output, and prior model summaries;
- attempts to choose another site, capability, scope, model, connection,
  approval, recipient, URL, or budget;
- data-exfiltration attempts through content links, capability arguments,
  provider errors, redirects, DNS rebinding, private/metadata IPs, and connector
  destinations;
- pass condition is control integrity even if model text is fully compromised.

### Approval, action, and recovery tests

- argument, target version, policy, capability, plan, ChangeSet, site, agent,
  expiry, challenge, and approver tampering;
- approval replay, concurrent approve/reject, stale target, scope revocation,
  agent disable, and credential revoke;
- crash before/after capability execution and audit/result persistence;
- caller-stable idempotency prevents duplicate writes;
- verification detects partial/ambiguous application and invokes only the
  registered undo;
- sensitive/non-reversible actions never auto-approve.

### Denial-of-wallet and operations tests

- request floods aggregate before jobs/model calls;
- budget reservations serialize under concurrency and unknown usage/cost does
  not become zero;
- per-run loops, token caps, timeouts, cooldowns, site job quota, and all
  breakers hold at boundaries;
- provider 401/429/5xx/timeout/invalid-output storms have bounded retries;
- queue restart resumes runs without duplicate provider-authorized actions;
- emergency pause/revoke works with provider down and preserves
  verification/undo;
- retention pruning is bounded, site-scoped, respects the v1 hard maxima, and
  cannot remove active evidence.

### Deployment and documentation gates

- Doctor validates vault intent, OAuth origins/audiences, provider adapters,
  credential metadata, scope inventory, retention, redaction, budgets,
  breakers, and handler/schedule registration;
- production readiness blocks plaintext/disabled-required vault modes,
  insecure OAuth origins, unmeasurable enforced budgets, unsafe multi-node rate
  limiting, and missing worker for enabled runtime agents;
- OpenAPI/MCP expose only redacted exact contracts;
- Agent Studio contains emergency pause, revoke, rotate, approval, incident,
  spend, and audit workflows;
- create-nexpress scaffold defaults server-side agents and remote mutations off;
- live guides include key compromise, prompt injection, cross-tenant,
  denial-of-wallet, KMS outage, and rollback runbooks;
- package changesets and a threat-model review are required before release.

## Secure defaults checklist

A newly generated site starts with:

- remote Agent Gateway mutation disabled;
- no provider connection and vault mode `disabled`;
- no enabled server-side agent triggers;
- role templates in preview/read-only mode;
- automatic writes disabled except explicitly configured deterministic
  reversible actions;
- provider diagnostic body retention off;
- external egress limited to deployment-registered adapters;
- service credential expiry required;
- `security.revokeSessions`, publish, and ops execution human-approved;
- existing auth lockout, CSRF, exact sessions, and proxy rate limiting active;
- Doctor warnings that identify every control required before enabling
  unattended operation.
