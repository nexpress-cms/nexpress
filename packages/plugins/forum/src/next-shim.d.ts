declare module "next/link" {
  import type * as React from "react";

  export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    href: string;
  }

  const Link: React.ForwardRefExoticComponent<LinkProps & React.RefAttributes<HTMLAnchorElement>>;

  export default Link;
}

declare module "next/navigation" {
  export interface AppRouterInstance {
    push(href: string): void;
    replace(href: string): void;
    refresh(): void;
  }

  export interface ReadonlyURLSearchParams {
    get(name: string): string | null;
    toString(): string;
  }

  export function usePathname(): string;
  export function useRouter(): AppRouterInstance;
  export function useSearchParams(): ReadonlyURLSearchParams;
  export function notFound(): never;
  export function redirect(url: string): never;
  export function permanentRedirect(url: string): never;
}

declare module "next" {
  export interface Metadata {
    title?: string | null;
    description?: string | null;
    openGraph?: Record<string, unknown>;
    twitter?: Record<string, unknown>;
    robots?: Record<string, unknown>;
    alternates?: Record<string, unknown>;
    other?: Record<string, unknown>;
  }
}
