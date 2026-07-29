import type { NpResolvedNavItem } from "@nexpress/core/navigation";
import { getCachedNavigation } from "@nexpress/next";
import Link from "next/link";

import { resolveStorefrontSettings } from "./settings-helpers.js";

export async function StorefrontFooter() {
  const [items, settings] = await Promise.all([
    getCachedNavigation("footer"),
    resolveStorefrontSettings(),
  ]);
  return (
    <footer className="np-storefront-footer">
      <div className="np-storefront-container np-storefront-footer-grid">
        <section>
          <strong>{settings.brandName}</strong>
          <p>{settings.tagline}</p>
        </section>
        <nav aria-label="Footer">
          {items.map((item: NpResolvedNavItem) => (
            <Link key={`${item.url}-${item.label}`} href={item.url}>
              {item.label}
            </Link>
          ))}
        </nav>
        <section>
          <strong>Journal</strong>
          <p>제품과 재료, 오래 사용하는 방법을 기록합니다.</p>
          <Link href="/blog">Read stories</Link>
        </section>
      </div>
      <div className="np-storefront-container np-storefront-footer-meta">
        <span>Powered by NexPress</span>
        <span>Catalog surfaces are optional extensions.</span>
      </div>
    </footer>
  );
}
