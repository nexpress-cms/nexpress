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
 *   - `outputFileTracingIncludes` traces sharp's Linux native
 *     payload through pnpm's real store paths. Vercel standalone
 *     functions otherwise can ship the JS wrapper without the
 *     matching `@img/sharp-*` / libvips package, which fails at
 *     runtime on first media processing.
 *
 * Overrides are shallow-merged except `outputFileTracingIncludes`,
 * whose route globs are appended so custom includes don't drop the
 * sharp runtime guard. Pass arrays to *replace* transpilation /
 * external-package defaults entirely, or use the spread helper:
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
  "@nexpress/theme-community",
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

type OutputFileTracingIncludes = NonNullable<NextConfig["outputFileTracingIncludes"]>;

export const defaultOutputFileTracingIncludes: OutputFileTracingIncludes = {
  "/*": [
    // Use pnpm's real package store paths, not top-level node_modules symlinks.
    // Vercel rejects symlinked directories in traced Serverless Function
    // artifacts, while these globs survive sharp / libvips patch bumps.
    "./node_modules/.pnpm/sharp@*/node_modules/sharp/**/*",
    "./node_modules/.pnpm/@img+sharp-linux-*/node_modules/@img/sharp-linux-*/**/*",
    "./node_modules/.pnpm/@img+sharp-libvips-linux-*/node_modules/@img/sharp-libvips-linux-*/**/*",
    "./node_modules/.pnpm/@img+sharp-linuxmusl-*/node_modules/@img/sharp-linuxmusl-*/**/*",
    "./node_modules/.pnpm/@img+sharp-libvips-linuxmusl-*/node_modules/@img/sharp-libvips-linuxmusl-*/**/*",
  ],
};

function mergeOutputFileTracingIncludes(
  defaults: OutputFileTracingIncludes,
  overrides: NextConfig["outputFileTracingIncludes"],
): OutputFileTracingIncludes {
  const merged: OutputFileTracingIncludes = {};

  for (const [route, includes] of Object.entries(defaults)) {
    merged[route] = [...includes];
  }

  if (!overrides) return merged;

  for (const [route, includes] of Object.entries(overrides)) {
    const current = merged[route] ?? [];
    merged[route] = [...current, ...includes.filter((include) => !current.includes(include))];
  }

  return merged;
}

export function createNextConfig(overrides: NextConfig = {}): NextConfig {
  const { outputFileTracingIncludes, ...rest } = overrides;

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
    ...rest,
    outputFileTracingIncludes: mergeOutputFileTracingIncludes(
      defaultOutputFileTracingIncludes,
      outputFileTracingIncludes,
    ),
  };
}
