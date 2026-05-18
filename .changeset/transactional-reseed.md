---
"@nexpress/core": patch
"@nexpress/app": patch
---

Reseed is now fully atomic — the wipe + active-theme flip + seed all run inside one `db.transaction`. Any failure (most often the slug-collision case the 409 handler catches) rolls back every SQL write the call made; the operator never sees a half-state where the wipe committed but the seed didn't write.

`saveDocument` joins `deleteDocument` in accepting an `NpTransaction` handle via its existing `NpSaveOptions` bag (`{ status, tx }`). The pipeline threads the handle through every read (`getDocumentByIdInternal`), every write (`createMainDocument` / `updateMainDocument` / `syncChildTables` / `syncJoinTables` / `syncMediaRefsForDocument` / `npSlugHistory` insert / `insertRevision`), and skips opening its own private tx when the caller provided one. Existing call sites that don't pass `tx` are unaffected — `saveDocument(coll, id, data, user)` still opens a private cascade tx like before.

`setActiveThemeId` learns the same `{ tx }` option so the `np_settings.activeTheme` write joins the same scope. `wipeSeededContent` / `seedTerms` / `seedPages` / `seedPosts` / `seedNavigation` / `seedAll` all gain the option and forward it through.

Post-commit hooks (`content:afterSave` / `content:afterDelete` jobs + plugin equivalents) still fire per-row inside the tx; their side-effects (cache busts, audit log writes on separate connections) can diverge from final DB state on rollback. Same trade-off as `#807`'s wipe-only transaction.
