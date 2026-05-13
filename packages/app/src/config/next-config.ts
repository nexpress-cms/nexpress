import type { NextConfig } from "next";

/**
 * Default NexPress Next.js config. Reference apps/web and
 * scaffolded projects both call `createNextConfig()` from
 * `next.config.ts`; overrides can be passed in to extend
 * `transpilePackages`, `serverExternalPackages`, etc. without
 * forking the file.
 *
 * The base config:
 *
 *   - `output: "standalone"` — produces a self-contained
 *     `.next/standalone/` bundle for Docker / Vercel.
 *   - `transpilePackages` lists every workspace UI package whose
 *     source ships as raw `.tsx`. `@nexpress/app` is included so
 *     Next compiles the shared route/page implementations using
 *     the consumer's tsconfig (which is what makes `@/lib/...`
 *     resolve to the consumer's actual file at the package edge).
 *   - `serverExternalPackages` keeps native bindings (sharp,
 *     argon2, pg, pg-boss) out of the bundle so they're loaded
 *     via Node's normal resolution at runtime instead of being
 *     mangled by Turbopack.
 *
 * Overrides are shallow-merged — pass arrays to *replace* the
 * defaults entirely, or use the spread helper:
 *
 *   export default createNextConfig({
 *     transpilePackages: [
 *       ...defaultTranspilePackages,
 *       "@my-org/internal-ui",
 *     ],
 *   });
 */
export const defaultTranspilePackages = [
  "@nexpress/admin",
  // `@nexpress/app` ships its page implementations as raw .tsx
  // for both apps/web and scaffolded sites to re-export. Listed
  // here so Next compiles those pages with this project's
  // tsconfig — that's what makes the `@/lib/init-core` import
  // resolve to the consumer's actual file at the package's edge.
  "@nexpress/app",
  "@nexpress/auth-pages",
  "@nexpress/editor",
  "@nexpress/blocks",
  "@nexpress/theme",
  "@nexpress/theme-default",
  "@nexpress/theme-docs",
  "@nexpress/theme-magazine",
  "@nexpress/theme-portfolio",
  "@nexpress/next",
  "@nexpress/plugin-sdk",
] as const;

export const defaultServerExternalPackages = [
  "@nexpress/core",
  "@node-rs/argon2",
  "pg",
  "pg-native",
  "pg-boss",
  "sharp",
] as const;

export function createNextConfig(overrides: NextConfig = {}): NextConfig {
  return {
    output: "standalone",
    transpilePackages: [...defaultTranspilePackages],
    // Next 16 made Turbopack the default bundler. The previous
    // `webpack` callback just pushed Node-native bindings to
    // `externals`; `serverExternalPackages` already does that for
    // both bundlers, so the callback is redundant. `pg-native` is
    // listed alongside `pg` because it's an optional native binding
    // pg pulls in dynamically — Turbopack would otherwise try to
    // bundle it.
    serverExternalPackages: [...defaultServerExternalPackages],
    ...overrides,
  };
}
