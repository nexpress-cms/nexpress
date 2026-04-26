import type { ComponentType, ReactNode } from "react";

import type {
  NxRegisteredTheme,
  NxThemeManifest,
  NxThemeTokens,
} from "@nexpress/core";

/**
 * Phase 11.1 — `NxTheme` is the typed shape themes export.
 * Extends the core's opaque `NxRegisteredTheme.impl` slot
 * with React component types so consumers (the framework's
 * site layout, the admin theme picker) can render the right
 * pieces without typing them as `unknown` everywhere.
 *
 * Themes ship as npm packages that call `defineTheme(...)`
 * and export the result. The reference app registers them
 * in `nexpress.config.ts`'s `themes` array.
 */

export interface NxThemeShellProps {
  children: ReactNode;
}

export interface NxThemeSlots {
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

export interface NxTemplateRenderProps<T = Record<string, unknown>> {
  /** The doc being rendered, in whatever shape the collection produces. */
  doc: T;
}

/**
 * A single page template. Each template carries human-readable
 * metadata so the admin picker (11.3) can render a meaningful
 * dropdown — bare component refs would force callers to maintain
 * a parallel id→label map.
 */
export interface NxThemeTemplate<T = Record<string, unknown>> {
  /** Human label shown in the admin template picker. */
  label: string;
  /** Optional description shown beneath the picker. */
  description?: string;
  /** The render component receives `{ doc }` and returns the page body. */
  component: ComponentType<NxTemplateRenderProps<T>>;
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
export type NxThemeTemplates = Record<
  string,
  Record<string, NxThemeTemplate>
>;

export interface NxThemeImpl {
  /** Site-wide shell. Wraps every (site) route. */
  shell?: ComponentType<NxThemeShellProps>;
  slots?: NxThemeSlots;
  /** Per-collection page templates (`{ posts: { default: ..., featured: ... } }`). */
  templates?: NxThemeTemplates;
  /** Default tokens. Admin overrides via the theme settings tab (11.4). */
  tokens?: Partial<NxThemeTokens>;
  /**
   * Theme-owned CSS, served alongside the theme's components.
   * The framework injects this as a `<style data-nx-theme="{id}">`
   * tag in the layout's head when this theme is active. Phase 11.2
   * lets themes ship the layout-level rules (header / footer /
   * shell) that previously lived in `apps/web/globals.css` so a
   * theme swap actually changes the rendered shell, not just the
   * components but the styles around them. Cross-theme primitives
   * (form inputs, member auth pages, etc.) stay in the consuming
   * app's globals.css because they aren't theme-specific.
   */
  css?: string;
}

export interface NxTheme extends NxRegisteredTheme {
  manifest: NxThemeManifest;
  impl: NxThemeImpl;
}

/**
 * Identity helper. Themes call this so TypeScript infers the
 * full `NxTheme` shape; the runtime is a no-op pass-through.
 * Mirrors `definePlugin()` and `defineCollection()` from the
 * rest of the framework.
 */
export function defineTheme(theme: NxTheme): NxTheme {
  return theme;
}
