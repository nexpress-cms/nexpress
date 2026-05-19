/**
 * Friendlier wording for the pg connection errors operators actually
 * hit in setup. Extracted into its own module so unit tests can
 * exercise it without booting the HTTP server (importing setup-server.ts
 * triggers `createServer` at module top level by design).
 *
 * Most pg-node errors are clear enough on their own, but the three
 * codes below are the setup-blocking shapes worth spelling out:
 *
 *   - sqlstate 3D000 ("database does not exist") — common first-run
 *     stumble; needs the exact `psql` command to fix it.
 *   - sqlstate 28P01 / 28000 ("auth failed") — almost always means a
 *     DIFFERENT Postgres instance is bound to the host port (another
 *     docker-compose stack, a system install). Our `docker compose up
 *     -d db` would have silently no-op'd against the existing
 *     container, so the operator needs to know to free the port.
 *   - ECONNREFUSED — nothing listening at all; the scaffold's
 *     docker-compose db service was never started.
 */

export interface PgConnectionLikeError {
  code?: unknown;
}

/**
 * Optional caller-supplied free port to recommend in the
 * port-collision (28P01 / 28000) message. The caller scans for a
 * free port BEFORE invoking the formatter — that's an IO call we
 * don't want this pure module to do.
 */
export interface MessageOptions {
  suggestedPort?: number | null;
}

export function messageForConnectionError(
  url: string,
  err: unknown,
  options: MessageOptions = {},
): string {
  const fallback = err instanceof Error ? err.message : String(err);
  const code = (err as PgConnectionLikeError | null)?.code;

  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    // Unparseable URL — fall through to per-code branches with
    // generic placeholders. The operator can still act on the advice.
  }
  const dbName = parsed?.pathname.replace(/^\//, "") || "<db>";
  const dbUser = parsed ? decodeURIComponent(parsed.username) || "nexpress" : "nexpress";
  const dbHost = parsed?.hostname || "localhost";
  const dbPort = parsed?.port || "5432";

  if (code === "3D000") {
    return (
      `Database "${dbName}" does not exist yet (sqlstate 3D000). ` +
      `Create it with:\n\n` +
      `  psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d postgres -c 'CREATE DATABASE "${dbName}"'\n\n` +
      `If you're using the scaffold's docker-compose, the container's POSTGRES_DB ` +
      `auto-creates the DB on first boot — stop the container, ` +
      `\`docker volume rm <project>_pgdata\` to wipe the old data dir, then ` +
      `\`docker compose -f docker/docker-compose.yml up -d db\` again.`
    );
  }

  if (code === "28P01" || code === "28000") {
    const suggestion =
      typeof options.suggestedPort === "number" && options.suggestedPort > 0
        ? `\n\nDetected free port: ${options.suggestedPort}. ` +
          `If you want to pick that, set:\n\n` +
          `  NEXPRESS_DB_PORT=${options.suggestedPort}\n` +
          `  DATABASE_URL=postgres://${dbUser}:<password>@${dbHost}:${options.suggestedPort}/${dbName}\n\n` +
          `in .env (the wizard's form will pick up the new port on the next reload), ` +
          `then \`docker compose -f docker/docker-compose.yml up -d db\` to bring up this project's DB on the new port.`
        : "";
    return (
      `Authentication failed for user "${dbUser}" on ${dbHost}:${dbPort} ` +
      `(sqlstate ${String(code)}).\n\n` +
      `A different Postgres instance is likely bound to host port ${dbPort} — ` +
      `another docker-compose stack, a system-wide install, or a previous ` +
      `scaffold from this machine. Our \`docker compose up -d db\` would have ` +
      `silently no-op'd against the existing container, so its credentials ` +
      `don't match this project's DATABASE_URL.\n\n` +
      `Fix one of:\n` +
      `  - Stop the conflicting service, then ` +
      `\`docker compose -f docker/docker-compose.yml up -d db\` to bring up this project's DB\n` +
      `  - Or pick a free port: set NEXPRESS_DB_PORT in .env and update ` +
      `DATABASE_URL's port to match, then re-run setup` +
      suggestion
    );
  }

  if (code === "ECONNREFUSED") {
    return (
      `Nothing is listening on ${dbHost}:${dbPort} (ECONNREFUSED).\n\n` +
      `If you're using the scaffold's docker-compose, start the database:\n\n` +
      `  docker compose -f docker/docker-compose.yml up -d db\n\n` +
      `Otherwise verify your Postgres server is running and reachable at this host/port.`
    );
  }

  return fallback;
}
