---
"@nexpress/admin": patch
"@nexpress/app": patch
"@nexpress/core": patch
"create-nexpress": patch
---

Unify code-owned custom routes behind one exact, bounded definition and Admin
wire contract. Generated sites now own a validated `npCustomRoutes` catalog;
source-scoped registration atomically replaces stale HMR entries and rejects
cross-source collisions. Admin route inventory, navigation autocomplete, the
protected API, scaffold, and `routes.contract` doctor diagnostics consume the
same static/dynamic path parser.
