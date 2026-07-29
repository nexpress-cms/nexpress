declare module "next/link" {
  import type * as React from "react";

  export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    href: string;
  }

  const Link: React.ForwardRefExoticComponent<LinkProps & React.RefAttributes<HTMLAnchorElement>>;

  export default Link;
}

declare module "next/navigation" {
  export function notFound(): never;
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
