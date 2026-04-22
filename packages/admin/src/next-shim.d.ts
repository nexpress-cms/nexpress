declare module "next/link" {
  import type * as React from "react";

  export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    href: string;
  }

  const Link: React.ForwardRefExoticComponent<
    LinkProps & React.RefAttributes<HTMLAnchorElement>
  >;

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
}
