---
"create-nexpress": patch
---

Migration child processes (`db:generate`, `pnpm exec drizzle-kit migrate`) now always use `stdio: "inherit"` — including in HTTP wizard mode. drizzle-kit only emits its real progress / error output when it has a real TTY; piped stdio left the captured buffer with just two spinner frames and silently dropped the actual error.

Inheriting hands the child whatever stdio the wizard parent has, which is the operator's actual terminal. The browser UI loses captured output but the terminal now shows exactly what running `pnpm exec drizzle-kit migrate` directly would show — same source, same formatting, same error fidelity.

The wizard UI's "migrations FAILED" state was updated to match: instead of an empty `<details>` toggle, it points the operator at their terminal and shows the exact re-run command (`cd <project> && pnpm exec drizzle-kit migrate`).
