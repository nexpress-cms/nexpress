---
"create-nexpress": patch
---

Scaffolded `seed:admin` script now counts only admin users, not all
users. Previously a fresh project that already had a non-admin row
(e.g. an OAuth identity stub or a test fixture) would refuse to
create the first admin, and `seed:content` would then fail with
"No admin user found" — leaving the project unable to bootstrap
either way. Counting `role = "admin"` matches the script's actual
intent.
