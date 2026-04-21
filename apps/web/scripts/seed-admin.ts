import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { config as loadEnv } from "dotenv";
import { count, eq } from "drizzle-orm";

import { createDbConnection, hashPassword, nxUsers } from "@nexpress/core";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env"), override: false });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const db = createDbConnection({ connectionString: databaseUrl });

async function promptLine(question: string, options?: { mask?: boolean }): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });

  if (options?.mask) {
    rl.output.write(question);
    stdin.resume();
    stdin.setEncoding("utf8");
    if (typeof (stdin as NodeJS.ReadStream & { setRawMode?: (v: boolean) => void }).setRawMode === "function") {
      (stdin as NodeJS.ReadStream & { setRawMode: (v: boolean) => void }).setRawMode(true);
    }

    return new Promise((resolvePrompt) => {
      let value = "";
      const onData = (chunk: string): void => {
        for (const ch of chunk) {
          if (ch === "\n" || ch === "\r" || ch === "\u0004") {
            if (typeof (stdin as NodeJS.ReadStream & { setRawMode?: (v: boolean) => void }).setRawMode === "function") {
              (stdin as NodeJS.ReadStream & { setRawMode: (v: boolean) => void }).setRawMode(false);
            }
            stdin.removeListener("data", onData);
            stdin.pause();
            rl.output.write("\n");
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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function main(): Promise<void> {
  const existing = await db.select({ value: count() }).from(nxUsers);
  const userCount = existing[0]?.value ?? 0;

  if (userCount > 0) {
    console.log(`DB already has ${userCount} user(s). Use the admin UI or the API to add more.`);
    process.exit(0);
  }

  const argEmail = process.argv[2] ?? process.env.NX_ADMIN_EMAIL;
  const argPassword = process.argv[3] ?? process.env.NX_ADMIN_PASSWORD;
  const argName = process.argv[4] ?? process.env.NX_ADMIN_NAME ?? "Admin";

  const email = argEmail ?? (await promptLine("Admin email: ")).trim();

  if (!isValidEmail(email)) {
    console.error(`"${email}" is not a valid email address.`);
    process.exit(1);
  }

  let password = argPassword;

  if (!password) {
    password = (await promptLine("Admin password (min 12 chars): ", { mask: true })).trim();
  }

  if (password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }

  const name = argName;
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

  await db.insert(nxUsers).values({
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
