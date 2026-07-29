import type { NpResolvedNavItem } from "@nexpress/core/navigation";
import { getCachedNavigation } from "@nexpress/next";
import Link from "next/link";

import { resolveStorefrontSettings } from "./settings-helpers.js";

export async function StorefrontHeader() {
  const [items, settings] = await Promise.all([
    getCachedNavigation("header"),
    resolveStorefrontSettings(),
  ]);
  return (
    <header className="np-storefront-header">
      <div className="np-storefront-announcement">{settings.announcement}</div>
      <div className="np-storefront-container np-storefront-header-main">
        <Link href="/" className="np-storefront-brand">
          <span aria-hidden="true">{settings.brandName.slice(0, 1).toUpperCase()}</span>
          <strong>{settings.brandName}</strong>
        </Link>
        <nav aria-label="Primary">
          {items.map((item: NpResolvedNavItem) => (
            <Link key={`${item.url}-${item.label}`} href={item.url}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="np-storefront-tools">
          <Link href="/search">Search</Link>
          <Link href="/members/login">Account</Link>
        </div>
      </div>
    </header>
  );
}
