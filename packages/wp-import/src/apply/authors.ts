import type { WpAuthor, WpImportBundle } from "../parse/types.js";

/**
 * Phase 21.8 — wire WP authors to NexPress staff users.
 *
 * The applier hands a callback the parsed author triple
 * `(login, email, displayName)` and expects either a NexPress user
 * id or `null` (skip — post lands without an author and is
 * attributed to the import actor by default).
 *
 * Default semantics on the shim side (design §7):
 *
 *   - Find a user by `login` (matched against the `name` column or
 *     a stored handle); if missing, create one with role `viewer`
 *     and an email flagged so it doesn't collide with a real
 *     account (`<original>+wp-import@<domain>`).
 *   - The opt-out branch (CLI `--no-create-authors`) returns null
 *     for every author, so posts get the import actor.
 */

export interface AuthorResolveInput {
  /** From <dc:creator> on the WP post. */
  wpAuthorLogin: string;
  /** The matching WXR <wp:author> entry, when one exists. May be undefined. */
  wpAuthor: WpAuthor | undefined;
}

export interface AuthorResolver {
  resolveAuthor: (input: AuthorResolveInput) => Promise<{ id: string } | null>;
}

export interface AuthorResolution {
  /** WP login → NexPress user id. */
  authorIds: Map<string, string>;
  /** Logins the resolver explicitly skipped (returned null). */
  skipped: string[];
  /** Logins where the resolver threw. */
  errors: Array<{ login: string; reason: string }>;
}

/**
 * Resolve every unique WP author login that appears on a non-
 * attachment record once. Returns the lookup the applier uses when
 * stamping `data.author` per record.
 */
export async function resolveAuthors(
  bundle: WpImportBundle,
  resolver: AuthorResolver,
): Promise<AuthorResolution> {
  const logins = new Set<string>();
  for (const record of bundle.records) {
    if (record.wpType === "attachment") continue;
    if (record.wpAuthorLogin) logins.add(record.wpAuthorLogin);
  }
  const byLogin = new Map(bundle.authors.map((a) => [a.login, a] as const));

  const authorIds = new Map<string, string>();
  const skipped: string[] = [];
  const errors: AuthorResolution["errors"] = [];

  for (const login of logins) {
    try {
      const out = await resolver.resolveAuthor({
        wpAuthorLogin: login,
        wpAuthor: byLogin.get(login),
      });
      if (out) {
        authorIds.set(login, out.id);
      } else {
        skipped.push(login);
      }
    } catch (err) {
      errors.push({ login, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { authorIds, skipped, errors };
}
