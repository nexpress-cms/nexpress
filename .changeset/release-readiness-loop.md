---
"@nexpress/app": patch
"@nexpress/cli": patch
"create-nexpress": patch
---

Add read-only release readiness gates.

Generated apps now include a `release` script. `nexpress release check`
combines deploy preflight, jobs, storage, and plugin diagnostics into
`schemaVersion: "np.release.v1"` before a release. `nexpress release verify`
combines health, jobs, storage, and plugin diagnostics into the same stable
envelope after deployment.
