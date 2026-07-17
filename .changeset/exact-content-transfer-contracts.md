---
"@nexpress/core": minor
"@nexpress/app": patch
---

Add the client-safe `@nexpress/core/content-transfer` v3 contract and connect
export, import, and active collection OpenAPI to the same exact bounded full or
partial envelope. Export now derives a site-scoped media manifest from actual
definition-owned references and fails instead of truncating large collections.

Import validates the complete payload before mutation, remaps only schema-owned
media references, preserves document UUIDs, orders relationship targets, and
applies document plus site configuration changes in one database transaction.
Reports now distinguish created and updated documents exactly.
