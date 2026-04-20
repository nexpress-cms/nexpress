declare module "next/link" {
  import type { ComponentType, ReactNode } from "react";

  const Link: ComponentType<{
    href: string;
    children?: ReactNode;
    className?: string;
    target?: string;
  }>;

  export default Link;
}

declare module "next/navigation" {
  export function useRouter(): {
    push: (href: string) => void;
    replace: (href: string) => void;
    refresh: () => void;
  };

  export function usePathname(): string;

  export function useSearchParams(): {
    get: (key: string) => string | null;
    toString: () => string;
  };
}
