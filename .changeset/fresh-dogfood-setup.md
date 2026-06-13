---
"@nexpress/app": patch
"create-nexpress": patch
---

Harden the freshly scaffolded site path after dogfooding the published CLI.
Generated Docker Compose files now pin a project-specific Compose name so
different NexPress projects do not share `docker-db-1` / `docker_pgdata`, and
generated `package.json` files pin the supported pnpm version for reproducible
installs. Non-interactive setup now falls back to the existing `.env` before
reading process environment overrides, so headless setup works from the
defaults that `create-nexpress` already wrote.
