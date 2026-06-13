---
"@nexpress/app": patch
"create-nexpress": patch
---

Ensure release builds regenerate the scaffold package whenever the NexPress
family version changes, so fresh projects pin the intended `@nexpress/*`
versions. `create-nexpress` also accepts absolute or relative target paths while
deriving the package-safe project name from the final path segment.

Also keep `nexpress ops status` focused on blocking errors: warning-level
follow-up commands no longer hide a database or environment blocker that needs
the doctor fix plan first.
