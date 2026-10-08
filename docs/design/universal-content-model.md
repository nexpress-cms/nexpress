# Universal Content Model — Design Decisions

Historical summary of the decisions locked on 2026-05-15. The built-in `posts`
collection and Docs theme now use content kinds; the draft's “U.1 implementation
next” status and implementation recipes are obsolete. Original detail remains
in Git history.

Current owners are [collection documents](../collection-documents.md),
[theme authoring](../theme-authoring.md), [theme/page authors](../theme-and-page-authors.md)
and [content transfer](../content-transfer.md). This record explains the choice;
it is not a migration script or a second runtime contract.

## 0. Position statement

Articles and documentation share long-form content behavior. Keeping them in
`posts` with a `kind` discriminator avoids parallel prose collections and lets
themes own their presentation without duplicating persistence.

## 1. Goals

Reuse collection validation, publication, revisions and authoring services.
Allow kind-specific labels, hierarchy and public routes while keeping one
content pipeline.

## 2. Non-goals

The design did not rename `posts`, merge block-based `pages` into it, collapse
taxonomies, or turn every plugin collection into a universal store. Distinct
product data and editing formats keep their own models.

## 3. Proposed shape

`article` is the baseline kind; themes can contribute other kind metadata and
fields through existing collection requirements. Docs uses `kind: "doc"` and
the existing `posts` seed slot. Hierarchical content uses the owning collection's
parent/order fields.

The early schemas and URL examples drifted and sometimes contradicted each
other about missing URL patterns. Current types, merge behavior, sidebar and
routing examples are maintained in the live guides linked above.

## 4. Capability model

The initial consolidation retained existing collection capabilities. Per-kind
publishing roles were a deferred idea requiring an actual operator need. A
kind label or Admin filter is not an authorization boundary.

## 5. Migration plan

The original migration needed to preserve documents, URLs, authorship and
references while detecting conflicting slugs. Generated schemas and reviewed
migration SQL own that transition; do not rerun a historical SQL sketch.
The obsolete `documents` seed slot was replaced by kind-bearing `posts` entries.
Compatibility decisions for external consumers require their own review.

## 6. Field-merge changes (3.2.a)

Select options were designed to merge by value, with later labels winning
for duplicate values. This rule does not imply that arbitrary fields or
relationship targets should be unioned. The canonical collection-requirement
merge and its tests own the exact precedence rules.

## 7. Implementation phases

U.1–U.4 staged the collection/Admin foundation, Docs theme migration, persisted
data migration and cleanup. The sequence is history rather than a pending work
queue or authority to rename schemas again.

## 8. Risks & open questions

Preserve existing site upgrades, slug-conflict handling, search and canonical
URLs, content permissions, hierarchy and external consumers. Folding `pages`
or adding per-kind permissions remains a separate design decision. The old
compatibility-alias recommendation is not permission to remove a live API.

## 9. What this doc does NOT decide

The record does not define current sidebar implementation, icon registration,
non-select field merging or additional content-kind permissions. Those details
belong to their current owning contracts.

## 10. Decision checkpoints — LOCKED 2026-05-15

The original checkpoints selected staged delivery, `article` as the default,
value-deduplicated select options, theme-owned kind URLs and reuse of the
`posts` seed slot. Historical PR scheduling and version labels are omitted.

## 11. Closeout

The essential rationale and compatibility constraints are retained here.
Implementation examples belong in the live guides; verification belongs in
feature tests and [testing guidance](../testing.md). Do not append chronological
implementation logs to this design summary.
