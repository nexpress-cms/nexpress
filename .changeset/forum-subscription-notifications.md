---
"@nexpress/app": patch
"@nexpress/core": patch
"@nexpress/plugin-forum": patch
---

Replace placeholder thread and tag follows with opt-in collection document
subscriptions, bounded activity fan-out, actionable notification destinations,
transactional cleanup, and orphan diagnostics. Add board and post subscription
controls to both bundled forum skins with deduplicated new-post and new-comment
notifications.
