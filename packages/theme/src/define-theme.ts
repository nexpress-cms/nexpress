import type { ComponentType, ReactNode } from "react";

import type { NpBlockRenderContext } from "@nexpress/blocks";
import type {
  NpRegisteredTheme,
  NpThemeColors,
  NpThemeManifest,
  NpThemeShape,
  NpThemeTypography,
} from "@nexpress/core";

/**
 * Local mirror of `NpThemeTokensOverlay` from `@nexpress/core` —
 * authored as `Partial`s of each sub-tree so a theme that overrides
 * only a few tokens (e.g. `colors.primary`) doesn't have to copy
 * the rest from `DEFAULT_THEME`. The runtime merger in
 * `@nexpress/core`'s `getTheme()` accepts the same shape and layers
 * it onto framework defaults before serving them. We re-declare
 * here instead of importing the named type because tsup's DTS
 * bundler refuses to resolve the symbol intermittently across
 * fresh dist rebuilds — the structural shape is what matters
 * downstream, the name is private to this file.
 */
export interface NpThemeTokensOverlay {
  colors?: Partial<NpThemeColors>;
  typography?: Partial<NpThemeTypography>;
  shape?: Partial<NpThemeShape>;
}

/**
 * Phase 11.1 — `NpTheme` is the typed shape themes export.
 * Extends the core's opaque `NpRegisteredTheme.impl` slot
 * with React component types so consumers (the framework's
 * site layout, the admin theme picker) can render the right
 * pieces without typing them as `unknown` everywhere.
 *
 * Themes ship as npm packages that call `defineTheme(...)`
 * and export the result. The reference app registers them
 * in `nexpress.config.ts`'s `themes` array.
 */

export interface NpThemeShellProps {
  children: ReactNode;
}

export interface NpThemeSlots {
  /**
   * Renders inside the shell, above the main content area.
   * Typically the site nav. The framework provides no fallback;
   * if a theme omits `header`, the area is simply absent.
   */
  header?: ComponentType;
  /** Renders below the main content area. */
  footer?: ComponentType;
  /** Stand-alone navigation surface (e.g. mobile drawer). */
  nav?: ComponentType;
  /** Side rail for templates that opt into it. Optional. */
  sidebar?: ComponentType;
  /** Renders just before the page's content (banners, breadcrumbs). */
  beforeContent?: ComponentType;
  /** Renders just after the page's content (CTA, related posts). */
  afterContent?: ComponentType;
}

export interface NpTemplateRenderProps<T = Record<string, unknown>> {
  /** The doc being rendered, in whatever shape the collection produces. */
  doc: T;
  /**
   * Server-built block render ctx (issue #476). The site renderer
   * builds one per page render and threads it through so theme
   * templates that call `renderBlocks(blocks)` can pass it on:
   *
   *   renderBlocks(blocks, { ctx: blockCtx })
   *
   * Without it, data-bound blocks (`latest-posts`, `stats.counter`,
   * etc.) render the "ctx unavailable" placeholder instead of
   * querying content. Theme packages that don't ship data-bound
   * blocks can ignore the field entirely; static themes keep the
   * pre-#476 call shape unchanged.
   */
  blockCtx?: NpBlockRenderContext;
}

/**
 * A single page template. Each template carries human-readable
 * metadata so the admin picker (11.3) can render a meaningful
 * dropdown — bare component refs would force callers to maintain
 * a parallel id→label map.
 */
export interface NpThemeTemplate<T = Record<string, unknown>> {
  /** Human label shown in the admin template picker. */
  label: string;
  /** Optional description shown beneath the picker. */
  description?: string;
  /** The render component receives `{ doc }` and returns the page body. */
  component: ComponentType<NpTemplateRenderProps<T>>;
}

/**
 * Per-collection page templates.
 *
 *   templates: {
 *     pages: {
 *       default: { label: "Default", component: PageDefault },
 *       wide:    { label: "Wide", component: PageWide },
 *     },
 *     posts: { default: { label: "Article", component: PostArticle } },
 *   }
 *
 * The catch-all reads `doc.template` (or falls back to `default`)
 * and renders the corresponding component. Themes that don't
 * declare templates for a collection let the framework's existing
 * rendering path run.
 */
export type NpThemeTemplates = Record<
  string,
  Record<string, NpThemeTemplate>
>;

export interface NpThemeImpl {
  /** Site-wide shell. Wraps every (site) route. */
  shell?: ComponentType<NpThemeShellProps>;
  slots?: NpThemeSlots;
  /** Per-collection page templates (`{ posts: { default: ..., featured: ... } }`). */
  templates?: NpThemeTemplates;
  /**
   * Default tokens. Each sub-tree (colors / typography / shape) is
   * a `Partial<...>` so a theme that overrides only a few keys
   * (e.g. `colors.primary` + `typography.fontHeading`) doesn't have
   * to copy the rest from `DEFAULT_THEME`. The runtime merger in
   * `getTheme()` layers this overlay onto the framework defaults
   * before serving them. Admin overrides via the theme settings
   * tab compose on top in turn.
   */
  tokens?: NpThemeTokensOverlay;
  /**
   * Theme-owned CSS, served alongside the theme's components.
   * The framework injects this as a `<style data-np-theme="{id}">`
   * tag in the layout's head when this theme is active. Phase 11.2
   * lets themes ship the layout-level rules (header / footer /
   * shell) that previously lived in `apps/web/globals.css` so a
   * theme swap actually changes the rendered shell, not just the
   * components but the styles around them. Cross-theme primitives
   * (form inputs, member auth pages, etc.) stay in the consuming
   * app's globals.css because they aren't theme-specific.
   */
  css?: string;
  /**
   * Phase 12.5 — UI string bundles per locale. Themes that
   * render hardcoded chrome ("Read more", "by {{author}}",
   * "{{minutes}} min read") localize them by registering keys
   * here and calling `t(key, locale, params)` from their
   * components. The theme registry merges these into the
   * global string registry at activation time.
   *
   *   i18n: {
   *     en: { "magazine.tagline": "Stories, essays, reports" },
   *     ko: { "magazine.tagline": "이야기, 에세이, 리포트" },
   *   }
   */
  i18n?: Record<string, Record<string, string>>;
}

export interface NpTheme extends NpRegisteredTheme {
  manifest: NpThemeManifest;
  impl: NpThemeImpl;
}

/**
 * Identity helper. Themes call this so TypeScript infers the
 * full `NpTheme` shape; the runtime is a no-op pass-through.
 * Mirrors `definePlugin()` and `defineCollection()` from the
 * rest of the framework.
 */
export function defineTheme(theme: NpTheme): NpTheme {
  return theme;
}
