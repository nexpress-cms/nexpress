import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";

import { createDbConnection, nxUsers } from "@nexpress/core";

/**
 * Phase 15.7 — promote a user to super-admin by email.
 *
 *   pnpm super-admin <email>
 *   pnpm super-admin --demote <email>
 *   pnpm super-admin                  # interactive prompt
 *
 * The first super-admin has to be created out-of-band (the
 * /api/admin/users/{id}/super-admin endpoint requires an
 * existing super-admin to call it — chicken-and-egg). This
 * script bypasses the API entirely and writes the
 * `is_super_admin` column directly via Drizzle.
 *
 * Idempotent: re-running on a user already at the target
 * state prints a friendly note and exits 0. Lets operators
 * stick this in automation without race-condition footguns.
 */

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env"), override: false });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const db = createDbConnection({ connectionString: databaseUrl });

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

interface ParsedArgs {
  email: string | null;
  demote: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let demote = false;
  let email: string | null = null;
  for (const arg of argv.slice(2)) {
    if (arg === "--demote") {
      demote = true;
    } else if (!arg.startsWith("--")) {
      email = arg;
    }
  }
  return { email, demote };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const email = args.email ?? (await promptLine("User email: "));

  if (!isValidEmail(email)) {
    console.error(`"${email}" is not a valid email address.`);
    process.exit(1);
  }

  const targetState = !args.demote;
  const action = targetState ? "Promote" : "Demote";

  const [user] = await db
    .select({
      id: nxUsers.id,
      email: nxUsers.email,
      name: nxUsers.name,
      isSuperAdmin: nxUsers.isSuperAdmin,
    })
    .from(nxUsers)
    .where(eq(nxUsers.email, email))
    .limit(1);

  if (!user) {
    console.error(`No user with email "${email}". Use \`pnpm seed:admin\` to create one first.`);
    process.exit(1);
  }

  if (user.isSuperAdmin === targetState) {
    console.log(
      `${user.email} is already ${targetState ? "a super-admin" : "not a super-admin"}; no change.`,
    );
    process.exit(0);
  }

  await db
    .update(nxUsers)
    .set({ isSuperAdmin: targetState, updatedAt: new Date() })
    .where(eq(nxUsers.id, user.id));

  console.log(`✓ ${action}d ${user.email} (${user.name})`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
