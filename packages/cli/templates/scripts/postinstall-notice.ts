/**
 * Tiny pointer printed once after `pnpm install`. The line that
 * trips new operators most often is `pnpm setup` vs `pnpm run setup`
 * — `pnpm setup` is a pnpm built-in (installs pnpm to PATH) and
 * silently no-ops with "No changes to the environment were made".
 * The wizard never fires, the operator thinks setup ran, then is
 * surprised when nothing works.
 *
 * We can't intercept `pnpm setup` itself (pnpm's own CLI handles
 * it before our scripts run). The next best moment to nudge is
 * right after `pnpm install`, which is the command everyone runs
 * before reaching for setup. If `.env` already exists we stay
 * silent — the operator has clearly been here before.
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

const lines = [
  "",
  `  ${BOLD}NexPress${RESET} — env not configured yet.`,
  "",
  `    ${CYAN}pnpm run setup${RESET}      ${DIM}# browser env wizard (DB / NX_SECRET / storage / migrations)${RESET}`,
  `    ${CYAN}pnpm run doctor${RESET}     ${DIM}# diagnose env / runtime if anything stalls${RESET}`,
  `    ${CYAN}pnpm dev${RESET}            ${DIM}# start once .env is in place; first /admin visit launches the in-app wizard${RESET}`,
  "",
  `  ${DIM}Note: \`pnpm setup\` and \`pnpm doctor\` are pnpm built-ins (installer / pnpm self-diagnose).${RESET}`,
  `  ${DIM}      Always invoke ours with \`pnpm run <name>\`, otherwise pnpm shadows the package script.${RESET}`,
  "",
];

for (const line of lines) {
  console.log(line);
}
