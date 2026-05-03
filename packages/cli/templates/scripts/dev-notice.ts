/**
 * Tiny gate run before \`next dev\` starts. When the operator hasn't
 * created a \`.env\` yet, dev would crash a few seconds later with
 * the "auth.secret too small" / "DATABASE_URL is not set" error.
 * That's still actionable, but only after pnpm has spent ~10s
 * compiling and Next has spun up workers. Bail out earlier with a
 * pointer at \`pnpm run setup\` — same surface as the postinstall
 * notice but at the moment the operator is trying to actually
 * start the app.
 *
 * Silent when \`.env\` exists; the dev loop is unchanged.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.exit(0);
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";

const lines = [
  "",
  `  ${YELLOW}NexPress${RESET} — \`.env\` is missing, so \`pnpm dev\` would just crash a few seconds in.`,
  "",
  `    ${CYAN}pnpm run setup${RESET}      ${DIM}# browser env wizard (DB / NX_SECRET / storage / migrations / first admin / sample content)${RESET}`,
  `    ${CYAN}pnpm run doctor${RESET}     ${DIM}# diagnose env / runtime if anything stalls${RESET}`,
  "",
  `  ${BOLD}Run \`pnpm run setup\` once, then \`pnpm dev\` will boot.${RESET}`,
  `  ${DIM}Note: \`pnpm setup\` and \`pnpm doctor\` are pnpm built-ins — always invoke ours with \`pnpm run <name>\`.${RESET}`,
  "",
];

for (const line of lines) {
  console.error(line);
}
process.exit(1);
