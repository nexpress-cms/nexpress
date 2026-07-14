---
"@nexpress/app": patch
"@nexpress/core": patch
"@nexpress/next": patch
"create-nexpress": patch
---

Unify local, S3, and custom storage under one exact runtime and object
contract. Validate configuration, safe keys, metadata, adapter kinds and
results across bootstrap, media, health, doctor, setup, and ops; add the
`@nexpress/core/storage` entry, custom bootstrap injection, and adapter
teardown. Custom adapters now declare `kind`, return exact Web stream, URL,
boolean, and void results, and may expose `shutdown()`.
