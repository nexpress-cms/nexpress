// Must be the first import — populates process.env before any
// other module evaluation reads it. seed-admin doesn't import
// the config so it would have worked without this, but the
// shared loader keeps both seed scripts on the same shape.
import "./_load-env.js";

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { count, eq } from "drizzle-orm";

import { hashPassword, npUsers } from "@nexpress/core";
import { createDbConnection } from "@nexpress/core/db";
import { npAuthContractLimits, npIsCanonicalAuthEmail } from "@nexpress/core/auth-contract";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const db = createDbConnection({ connectionString: databaseUrl });

async function promptLine(question: string, options?: { mask?: boolean }): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });

  if (options?.mask) {
    stdout.write(question);
    stdin.resume();
    stdin.setEncoding("utf8");
    if (
      typeof (stdin as NodeJS.ReadStream & { setRawMode?: (v: boolean) => void }).setRawMode ===
      "function"
    ) {
      (stdin as NodeJS.ReadStream & { setRawMode: (v: boolean) => void }).setRawMode(true);
    }

    return new Promise((resolvePrompt) => {
      let value = "";
      const onData = (chunk: string): void => {
        for (const ch of chunk) {
          if (ch === "\n" || ch === "\r" || ch === "\u0004") {
            if (
              typeof (stdin as NodeJS.ReadStream & { setRawMode?: (v: boolean) => void })
                .setRawMode === "function"
            ) {
              (stdin as NodeJS.ReadStream & { setRawMode: (v: boolean) => void }).setRawMode(false);
            }
            stdin.removeListener("data", onData);
            stdin.pause();
            stdout.write("\n");
            rl.close();
            resolvePrompt(value);
            return;
          }

          if (ch === "\u0003") {
            process.exit(130);
          }

          if (ch === "\u007f" || ch === "\b") {
            value = value.slice(0, -1);
            continue;
          }

          value += ch;
        }
      };

      stdin.on("data", onData);
    });
  }

  const answer = await rl.question(question);
  rl.close();
  return answer;
}

async function main(): Promise<void> {
  // Only block when an admin already exists. Counting all users
  // misfires when the DB has non-admin rows (test fixtures, OAuth
  // stub identities, members) but no real admin — `seed:content`
  // would then fail looking for an admin author.
  const existing = await db
    .select({ value: count() })
    .from(npUsers)
    .where(eq(npUsers.role, "admin"));
  const adminCount = existing[0]?.value ?? 0;

  if (adminCount > 0) {
    console.log(
      `DB already has ${adminCount} admin user(s). Use the admin UI or the API to add more.`,
    );
    process.exit(0);
  }

  const argEmail = process.argv[2] ?? process.env.NP_ADMIN_EMAIL;
  const argPassword = process.argv[3] ?? process.env.NP_ADMIN_PASSWORD;
  const argName = process.argv[4] ?? process.env.NP_ADMIN_NAME ?? "Admin";

  const email = (argEmail ?? (await promptLine("Admin email: "))).trim().toLowerCase();

  if (!npIsCanonicalAuthEmail(email)) {
    console.error("Admin email is not a valid email address.");
    process.exit(1);
  }

  let password = argPassword;

  if (!password) {
    password = (await promptLine("Admin password (min 12 chars): ", { mask: true })).trim();
  }

  if (password.length < 12 || password.length > npAuthContractLimits.passwordMaxLength) {
    console.error(
      `Password must contain 12 through ${npAuthContractLimits.passwordMaxLength.toString()} characters.`,
    );
    process.exit(1);
  }

  const name = argName.trim() || "Admin";
  if (name.length > npAuthContractLimits.nameLength) {
    console.error(
      `Admin name must not exceed ${npAuthContractLimits.nameLength.toString()} characters.`,
    );
    process.exit(1);
  }
  const passwordHash = await hashPassword(password);

  const existingEmail = await db
    .select({ id: npUsers.id })
    .from(npUsers)
    .where(eq(npUsers.email, email))
    .limit(1);

  if (existingEmail.length > 0) {
    console.error(`User with email "${email}" already exists.`);
    process.exit(1);
  }

  await db.insert(npUsers).values({
    email,
    password: passwordHash,
    name,
    role: "admin",
  });

  console.log(`✓ Admin created: ${email} (${name})`);
  console.log(`  Log in at http://localhost:3000/admin`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
