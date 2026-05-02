---
"@nexpress/core": patch
---

`verifyStartupSafety` now also fires the `multi_node_local_storage`
warning when `NODE_ENV=production` and a managed-container env var
is present (`KUBERNETES_SERVICE_HOST`, `FLY_REGION`,
`RENDER_INSTANCE_ID`), even if `NX_MULTI_NODE` wasn't explicitly set.
This catches the common footgun where an operator deploys to a
multi-replica platform and forgets the flag — the resulting
`./uploads` desync is silent until a user re-loads a page hitting a
different node.

`NxStartupSafetyInput` gains an optional `containerEnv: boolean`
field so the bootstrap layer can hand the resolved hint in without
this helper reading `process.env` itself. The field is optional for
back-compat; existing callers continue to work.

The emitted warning's `context.reason` distinguishes the two
trigger paths: `"explicit_flag"` for `NX_MULTI_NODE` and
`"container_hint"` for the new container-env path. `bootstrap.ts`
in `@nexpress/next` wires the new field automatically — apps using
the standard bootstrap inherit the new behavior on next deploy.
