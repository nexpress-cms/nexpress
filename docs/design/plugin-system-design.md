# NexPress Plugin System Design

Historical decisions from the 2026-04-17 plugin proposal. The original type
sketches, sandbox prototypes and hypothetical QA commands are in Git history.
This summary keeps the trust boundary and architectural rationale; it is not
a current API reference or a commitment to implement the proposed stages.

Current entry points: [plugin quickstart](../plugin-quickstart.md),
[manifest](../plugin-manifest.md), [capabilities](../plugin-capabilities.md),
[Admin extensions](../plugin-admin.md) and [reload behavior](../plugin-reload.md).

## Table of Contents

1. [Stage 1 MVP Plugin Contract](#1-stage-1-mvp-plugin-contract)
2. [Self-hosted Isolation Technology Selection](#2-self-hosted-isolation-technology-selection)
3. [Bridge Pattern for Next.js RSC](#3-bridge-pattern-for-nextjs-rsc)
4. [Declarative UI for Sandboxed Plugins](#4-declarative-ui-for-sandboxed-plugins)
5. [Static Analysis Tool Spec](#5-static-analysis-tool-spec)

## 1. Stage 1 MVP Plugin Contract

### 1.1 Design Principles

The proposal favored declarative manifests, explicit capabilities, namespaced
resources and separate rendering/server responsibilities. These make plugins
inspectable by people and agents and keep extension points owned by the host.
The claim that every future sandbox could accept existing plugins unchanged
was a design ambition, not a compatibility guarantee.

### 1.1.1 v1 Plugin Execution Model (CRITICAL)

Plugins are trusted npm packages installed through application configuration.
Installing code is a deployment change. Collection or field changes still need
schema generation and migration; reload is not a general-purpose package
installer. [Reload behavior](../plugin-reload.md) defines which existing
registrations and settings can be refreshed without a deployment.

Plugins run in-process with full Node.js access. A trusted plugin has the
permissions of the CMS process: it can access the database, environment and
other server resources. Only install code from authors you trust. Capability
checks through host APIs do not sandbox arbitrary plugin code.

### 1.2 Capability Enum

The original enum is superseded by the [capability mapping](../plugin-capabilities.md).
A manifest declaration and a scoped host API support explicit permissions;
they are not an isolation boundary against malicious in-process code.

### 1.3 Plugin Manifest Schema

Use the [manifest reference](../plugin-manifest.md) for required fields,
defaults and derived metadata. Maintaining a second schema in a design document
caused the proposal to diverge from the SDK.

### 1.4 definePlugin() API

Use the [quickstart](../plugin-quickstart.md) and focused guides for
[hooks](../plugin-hooks.md), [API routes](../plugin-api-routes.md),
[pages](../plugin-pages.md), [blocks](../plugin-blocks.md),
[patterns](../plugin-patterns.md), [templates](../plugin-templates.md),
[translations](../plugin-i18n.md) and [scheduled tasks](../plugin-scheduled-tasks.md).

### 1.5 PluginContext Interface

The host supplies services through a capability-aware context. Reuse those
services so plugin operations preserve content ACLs, hooks, validation and
lifecycle rules. The exact `ctx.*` mapping is maintained in
[capabilities](../plugin-capabilities.md).

### 1.6 Plugin Registration Flow

Registration validates and owns extension definitions rather than discovering
arbitrary new application routes at request time. Installed code and per-site
activation are separate concepts; [Admin extensions](../plugin-admin.md)
describes current site activation and configuration semantics.

### 1.7 Example Plugin

Working examples and setup instructions live in the [quickstart](../plugin-quickstart.md).
The removed example duplicated SDK declarations and no longer matched them.

## 2. Self-hosted Isolation Technology Selection

The proposal separated trusted execution, permission-scoped host services and
future untrusted execution. It considered V8 isolates, workers/processes,
WebAssembly and SES. Its resource estimates, library comparisons and claims
of a preferred runtime were preliminary research, not a shipped security
assessment or deployment requirement.

The useful distinction remains: capability checks can prevent accidental
host-API overreach, while untrusted execution requires an independently
validated isolation boundary. Node's `vm` context was explicitly rejected as
a standalone security boundary. Any future design must address memory/CPU
limits, serialization, I/O authority, failure disposal and operator ownership
before claiming sandbox support.

## 3. Bridge Pattern for Next.js RSC

Next.js build-time routing motivated a host-owned catch-all and registered
component resolution. Rendering and server effects were kept distinct so host
services could own validation and action dispatch. Current route matching,
shells and server/client boundaries are in [plugin pages](../plugin-pages.md)
and [API routes](../plugin-api-routes.md).

The proposed sandbox bridge used serialized calls rather than sharing host
objects or callbacks with untrusted code. That transport sketch is historical;
it does not describe an available plugin sandbox.

## 4. Declarative UI for Sandboxed Plugins

A host-rendered UI description was proposed to avoid executing sandboxed React
components in the Admin tree and to keep theme behavior consistent. The live
[Admin contract](../plugin-admin.md) now owns declarative widgets, actions,
tables and configuration forms. The old optional `NpWidget` union and arbitrary
Admin React component examples do not describe that contract.

## 5. Static Analysis Tool Spec

The original plan proposed lint rules and SDK commands for manifest integrity,
capability usage and theme conventions. Those command examples were not proof
of implemented tools. Use the [quickstart](../plugin-quickstart.md), SDK package
scripts and [testing guide](../testing.md) for supported authoring checks.
Static analysis never establishes a sandbox boundary.

## Appendix A: Key Design Decisions

Retained decisions are trusted package installation, explicit extension
registration, namespaced resources, sequential lifecycle pipelines,
host-owned dispatch and shared theme conventions. Exact metadata, route and
Admin shapes belong to the live guides linked above.

## Appendix B: Migration Path (Stage 1 → 2 → 3)

The trust → permissions → isolation sequence was a research direction.
Permission-aware services do not mean a plugin runs in isolation, and the
sequence neither promises zero-change migration nor schedules sandbox work.

## Appendix C: QA Scenarios (per section)

The original scenarios were proposed checks for the design, including
unimplemented sandbox and CLI surfaces. They were not acceptance evidence.
Run the relevant SDK, Core, Admin and consumer checks described by
[testing](../testing.md); retain any unmet acceptance gates in their owning
feature records.
