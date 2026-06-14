---
"@nexpress/app": patch
"create-nexpress": patch
---

Polish fresh-project and ops developer UX. Scaffold success output now keeps the
first-run path focused on the next useful commands, generated README guidance
matches the `.env` fallback behavior of non-interactive setup, setup-server
prints copy-pasteable `pnpm run setup -- ...` fallback commands, and worker
fix-plan/runbook suggestions include `NP_ENABLE_JOBS=1` with the project-side
worker script.
