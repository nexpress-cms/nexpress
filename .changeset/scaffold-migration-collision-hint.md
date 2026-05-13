---
"create-nexpress": patch
---

When the migration runner hits sqlstate `42710` (duplicate type) or `42P07` (duplicate table) — the "another NexPress install owns this DB" case the pre-flight can't detect when `drizzle.__drizzle_migrations` already exists — surface the recovery options inline instead of leaving the operator on the raw pg error message:

```
✗ migration failed:
  …
  sqlstate: 42710

  This database already contains tables/types from another NexPress
  install. Pick one:
    1. Point DATABASE_URL at a fresh database (recommended for multi-project hosts)
    2. Drop and recreate this one:
       docker compose -f docker/docker-compose.yml exec db psql -U nexpress \
         -c 'DROP DATABASE "<name>"; CREATE DATABASE "<name>";'
       (this DESTROYS all data in '<name>')
```

Pure additive — non-collision failures still print the same Error + sqlstate they always did.
