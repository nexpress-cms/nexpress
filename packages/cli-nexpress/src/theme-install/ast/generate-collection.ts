import type {
  NpThemeCollectionRequirement,
  NpThemeFieldRequirement,
} from "@nexpress/core";

/**
 * Phase F.8-B — emitters for fresh collection files and the
 * field literals appended to existing ones.
 *
 * String-templating instead of ts-morph for these emits because
 * we control the entire shape — the patcher (which mutates an
 * unknown operator-authored file) is the only place where AST
 * preservation matters. Fresh files start canonical, so a
 * template is the right tool.
 *
 * The emitted shapes intentionally mirror the create-nexpress
 * scaffold's collection style so operators see consistent
 * formatting whether their collection was scaffold-generated
 * or theme-installed.
 */

function quote(s: string): string {
  // Double-quoted string with conservative escaping. Theme
  // requirement names don't include unusual characters in
  // practice, but be safe.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function titleCase(s: string): string {
  return s
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Render a single field literal (`{ name, type, ... }`) for
 * insertion into a `fields: [...]` array. Used by both the
 * patcher (append to existing array) and the new-file
 * generator (build the initial array).
 */
export function renderFieldLiteral(
  name: string,
  req: NpThemeFieldRequirement,
): string {
  const parts: string[] = [
    `name: ${quote(name)}`,
    `type: ${quote(req.type)}`,
  ];
  if (req.required) parts.push("required: true");
  if (req.relationTo !== undefined) {
    if (Array.isArray(req.relationTo)) {
      parts.push(
        `relationTo: [${req.relationTo.map((s) => quote(s)).join(", ")}]`,
      );
    } else {
      parts.push(`relationTo: ${quote(req.relationTo)}`);
    }
  }
  if (req.hasMany) parts.push("hasMany: true");
  return `{ ${parts.join(", ")} }`;
}

/**
 * Render a fresh `src/collections/<slug>.ts` file body for a
 * collection that doesn't exist yet. The shape mirrors the
 * scaffold's defineCollection style.
 */
export function renderNewCollectionFile(
  slug: string,
  requirement: NpThemeCollectionRequirement,
): string {
  const fields = Object.entries(requirement.fields ?? {}).map(([name, req]) =>
    `    ${renderFieldLiteral(name, req)},`,
  );
  const titled = titleCase(slug);
  // Singular/plural defaulting: drop trailing 's' for singular
  // when slug is plural-shaped; otherwise reuse. Operators can
  // adjust labels by hand — this is a sensible default, not a
  // commitment.
  const singular = slug.endsWith("s") ? titleCase(slug.slice(0, -1)) : titled;
  const plural = titled;

  const lines = [
    `import { defineCollection } from "@nexpress/core";`,
    "",
    `export const ${camelCase(slug)}Collection = defineCollection({`,
    `  slug: ${quote(slug)},`,
    `  labels: { singular: ${quote(singular)}, plural: ${quote(plural)} },`,
    `  fields: [`,
    ...fields,
    `  ],`,
    `});`,
    "",
  ];
  return lines.join("\n");
}

function camelCase(s: string): string {
  return s.replace(/[-_](.)/g, (_, ch: string) => ch.toUpperCase());
}
