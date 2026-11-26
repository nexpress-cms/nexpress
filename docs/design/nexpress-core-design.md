# NexPress Core System Design

Historical decisions from the 2026-04-17 core proposal. The original API,
schema, configuration and deployment sketches are preserved in Git history;
they are not current implementation instructions. This summary retains the
rationale and original top-level section anchors.

Use the [architecture reference](../agent-guidance/reference/root.md#architecture)
and [live guides](../README.md) for current behavior. The companion
[plugin design](plugin-system-design.md) records the original trust model.

## Table of Contents

- [A. Database Schema](#a-database-schema)
- [B. Content Modeling System](#b-content-modeling-system)
- [C. Authentication & Authorization](#c-authentication--authorization)
- [D. Rendering Layer](#d-rendering-layer)
- [E. Admin UI Architecture](#e-admin-ui-architecture)
- [F. Editor System](#f-editor-system)
- [G. Media System](#g-media-system)
- [H. Theme Engine](#h-theme-engine)
- [I. Agent Interface](#i-agent-interface)
- [J. CLI & Project Structure](#j-cli--project-structure)
- [K. Routing Contract](#k-routing-contract-cb-3)
- [L. Write Pipeline & Access Control](#l-write-pipeline--access-control-cb-5-cb-6)
- [M. Background Jobs & Worker](#m-background-jobs--worker-cb-4)
- [N. Platform Policies](#n-platform-policies-hs-8-ms-3-ms-7-hs-6-ms-1-ms-2-ms-4-ms-6)
- [O. Schema Evolution & Validation](#o-schema-evolution--validation-hs-1-hs-3-hs-4)
- [P. Search](#p-search-hs-7)
- [QA Scenarios](#appendix-qa-scenarios)

## A. Database Schema

The proposal chose generated Drizzle tables per code-defined collection rather
than one JSONB document store. Filtering, sorting, relationships, uniqueness
and publication queries benefit from SQL columns; structured editor content
still needs JSON storage. Schema generation and reviewed migrations remain
separate from runtime writes. See [collection documents](../collection-documents.md).

## B. Content Modeling System

Collection definitions were intended to drive schema, validation, types,
Admin forms and API behavior from one source. The retained principle is to
reuse that pipeline instead of creating a second model for plugins or agents.
See [Core guidance](../agent-guidance/reference/core.md) for implementation ownership.

## C. Authentication & Authorization

Local authentication was selected for a self-hosted CMS, using signed tokens
and password hashing without coupling the initial product to an external auth
framework. OAuth/SSO was an escalation criterion, not a reason to prebuild an
unused abstraction. Cookie names, token lifetimes, session rows, revocation,
CSRF and staff/member boundaries now belong to [authentication](../authentication.md).
The proposal's endpoint sketches must not be copied as security contracts.

## D. Rendering Layer

Public and Admin routes share a Next.js application, with import boundaries
preventing Admin client code from entering public bundles. Rendering should
reuse registered content, blocks and theme services. See
[theme and page authors](../theme-and-page-authors.md) and [caching](../caching.md).

## E. Admin UI Architecture

Admin components live in their own package and consume collection metadata
for common lists and forms. Public routes never import Admin. Current package
boundaries and reusable surfaces are in [Admin guidance](../agent-guidance/reference/admin.md).

## F. Editor System

The design separated long-form rich text from page composition using registered
blocks. It aimed to share content services and media identity across editors.
The early claim that both editors had one storage format was too broad:
[rich text](../rich-text.md) and [block content](../block-content.md) have distinct
wire contracts. See [in-page editing](../in-page-editor.md) for current behavior.

## G. Media System

A shared media service, storage adapters and asynchronous image processing
keep upload, editorial use and rendering on the same lifecycle. Persist media
identity instead of treating generated variant URLs as permanent identity.
Current record, response and lifecycle contracts are in [media](../media.md)
and [storage](../storage.md).

## H. Theme Engine

CSS custom properties and cascade layers let blocks follow a site theme
without hardcoded styling or client-side theme computation. The prototype
JSON schema and token examples have been superseded by
[theme tokens](../theme-tokens.md) and [theme authoring](../theme-authoring.md).

## I. Agent Interface

The original product direction exposed declarative, machine-readable CMS
interfaces while leaving model reasoning outside the CMS. The initial config
JSON, manifest, OpenAPI and import/export sketches are not the Agent Platform
contract. Use [Agent integration](../agent-integration.md),
[public discovery](../public-discovery.md), [content transfer](../content-transfer.md)
and the [Agentic Platform implementation set](agentic-platform/README.md).
Host injection, authority and acceptance boundaries remain owned there.

## J. CLI & Project Structure

Scaffolding should assemble reusable packages and a reference app rather than
forking framework internals. The original package tree, Dockerfile, CLI prompts
and dependency versions were prototypes. Use [site customization](../site-customization.md),
[bootstrap](../bootstrap.md) and [deployment](../deployment.md).

## K. Routing Contract (CB-3)

Reserved framework paths and collision validation protect Admin, API, media
and framework internals. Explicit route registration owns any permitted
built-in override. See [plugin API routes](../plugin-api-routes.md),
[plugin pages](../plugin-pages.md) and [custom routes](../custom-routes.md) for
the current distinction between route surfaces and their precedence.

## L. Write Pipeline & Access Control (CB-5, CB-6)

All content entry points must preserve collection access rules, validation,
hooks and revision behavior. Direct SQL shortcuts cannot substitute for the
collection write pipeline. Transaction ownership and current read/write
contracts belong to [collection documents](../collection-documents.md).

## M. Background Jobs & Worker (CB-4)

Durable work was separated from request handling so media processing and
scheduled tasks could retry outside the request lifetime. Persisted payloads
must carry the context needed by the worker; request-local state is not a
cross-process contract. See [jobs](../jobs.md), [media](../media.md) and
[scheduled publishing](../scheduled-publishing.md).

## N. Platform Policies (HS-8, MS-3, MS-7, HS-6, MS-1, MS-2, MS-4, MS-6)

The proposal identified safe API errors, rate limiting, CSS validation,
revision retention, cache isolation and storage deployment limits as shared
policies. Their current definitions are maintained in
[API errors](../api-error-codes.md), [rate limiting](../rate-limiting.md),
[theme tokens](../theme-tokens.md), [revisions](../revisions.md),
[caching](../caching.md) and [storage](../storage.md).
Draft content must remain isolated from public caches; local media storage
must not be assumed shared between replicas.

## O. Schema Evolution & Validation (HS-1, HS-3, HS-4)

Runtime validation complements generated types, and schema evolution needs
reviewed migration SQL. Media deletion must respect the owning lifecycle and
references. The original code sketches do not authorize destructive schema
changes. See [Core guidance](../agent-guidance/reference/core.md),
[collection documents](../collection-documents.md) and [media](../media.md).

## P. Search (HS-7)

PostgreSQL full-text search was selected as a useful self-hosted baseline;
search should remain behind an adapter rather than leak database specifics
into callers. Current queries, indexing, cache and diagnostics contracts are
in [search](../search.md).

## Appendix: QA Scenarios

The original A–P scenarios were proposed tests, not recorded passing results.
Current commands, dependency build requirements and optional integration gates
are in [testing](../testing.md); feature guides own their acceptance criteria.
