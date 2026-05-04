---
"@nexpress/core": patch
---

`verifyStartupSafety`'s container-hint heuristic now recognizes
Railway alongside Kubernetes / Fly / Render. The warning fires in
production when `RAILWAY_ENVIRONMENT_NAME` is set and
`NX_STORAGE_ADAPTER=local`, catching multi-replica Railway deploys
that would otherwise silently desync `./uploads` between nodes.

The warning message is updated to list the new env var so operators
who hit it know which signal triggered it. `bootstrap.ts` in
`@nexpress/next` wires `RAILWAY_ENVIRONMENT_NAME` into the
`containerEnv` input automatically — apps using the standard
bootstrap inherit the new behavior on next deploy.
