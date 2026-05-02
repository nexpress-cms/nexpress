import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { config as loadEnv } from "dotenv";
import { count, eq } from "drizzle-orm";

import { createDbConnection, hashPassword, nxUsers } from "@nexpress/core";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../.env") });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const db = createDbConnection({ connectionString: databaseUrl });

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function main(): Promise<void> {
  // Only block when an admin already exists. Counting all users
  // misfires when the DB has non-admin rows (test fixtures, OAuth
  // stub identities, members) but no real admin — `seed:content`
  // would then fail looking for an admin author.
  const existing = await db
    .select({ value: count() })
    .from(nxUsers)
    .where(eq(nxUsers.role, "admin"));
  const adminCount = existing[0]?.value ?? 0;

  if (adminCount > 0) {
    console.log(`DB already has ${adminCount} admin user(s). Use the admin UI to add more.`);
    process.exit(0);
  }

  const email = process.argv[2] ?? process.env.NX_ADMIN_EMAIL ?? (await prompt("Admin email: "));
  if (!isValidEmail(email)) {
    console.error(`"${email}" is not a valid email address.`);
    process.exit(1);
  }

  const password =
    process.argv[3] ?? process.env.NX_ADMIN_PASSWORD ?? (await prompt("Admin password (min 12 chars): "));
  if (password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }

  const name = process.argv[4] ?? process.env.NX_ADMIN_NAME ?? "Admin";
  const passwordHash = await hashPassword(password);

  const existingEmail = await db
    .select({ id: nxUsers.id })
    .from(nxUsers)
    .where(eq(nxUsers.email, email))
    .limit(1);

  if (existingEmail.length > 0) {
    console.error(`User with email "${email}" already exists.`);
    process.exit(1);
  }

  await db.insert(nxUsers).values({ email, password: passwordHash, name, role: "admin" });
  console.log(`✓ Admin created: ${email} (${name})`);
  console.log(`  Log in at http://localhost:3000/admin`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
