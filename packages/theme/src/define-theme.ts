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
  /** Children = the theme's shell already rendered the surrounding chrome;
   *  the template returns its own body content. */
}

/**
 * Phase 11.1 reserves the templates surface but doesn't dispatch
 * yet — that lands in 11.3 alongside the `pages.template` field
 * and the admin picker. Themes can declare templates now to
 * future-proof their package.
 */
export type NxThemeTemplates = Record<
  string,
  Record<string, ComponentType<NxTemplateRenderProps>>
>;

export interface NxThemeImpl {
  /** Site-wide shell. Wraps every (site) route. */
  shell?: ComponentType<NxThemeShellProps>;
  slots?: NxThemeSlots;
  /** Per-collection page templates (`{ posts: { default: ..., featured: ... } }`). */
  templates?: NxThemeTemplates;
  /** Default tokens. Admin overrides via the theme settings tab (11.4). */
  tokens?: Partial<NxThemeTokens>;
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
