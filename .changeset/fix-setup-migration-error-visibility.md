---
"create-nexpress": patch
---

Make migration failures visible in `pnpm setup`, both in the browser UI and direct CLI runs.

The previous "silent-fail guard" only fired when the child's captured buffer was completely empty — drizzle-kit shipping a single ANSI escape sequence or newline left the buffer non-empty but visibly blank, so the empty `<details>` toggle stayed empty. Direct `pnpm db:migrate` was even worse: it goes through `pnpm run` → script → drizzle-kit, and somewhere in that chain drizzle-kit's silent exit on non-TTY became `ELIFECYCLE exit 1` with nothing else.

Three changes:

1. **Always append an exit-code footer** to every `runChild` call, regardless of buffer content. Footer shows `'cmd' exited with code N` and (on non-zero) the exact command line to re-run directly. Footer goes to terminal stderr AND into the captured output the browser UI shows.

2. **CLI / non-interactive modes use `stdio: "inherit"`** so the child writes straight to the operator's terminal — no pipe buffering, no TTY-detection quirks, no chance of an interactive prompt failing to render.

3. **Drop `strict: true` from the scaffolded `drizzle.config.ts`.** With strict on, drizzle-kit prompts the operator to confirm potentially-destructive diffs. When run as a child with piped stdio (which the wizard does in HTTP mode), the prompt can't render — drizzle-kit detects the non-TTY, exits silently with code 1. Operators who want strict diff prompts run `pnpm exec drizzle-kit migrate --strict` directly.

Also switched the wizard's `pnpm run db:migrate` invocation to `pnpm exec drizzle-kit migrate` — bypasses one pnpm script wrapper layer that has historically swallowed drizzle-kit stderr.
