---
"@nexpress/plugin-shop": patch
"@nexpress/app": patch
"create-nexpress": patch
---

Add a durable PII-free Shop order-update timeline and bounded transactional
member-inbox/email outbox across order, payment, fulfillment, delivery, return,
and refund transitions. Recipient email stays in a maximum-24-hour private
sidecar, Admin and Doctor expose only closed delivery health, and generated
project guidance documents the at-least-once email boundary.
