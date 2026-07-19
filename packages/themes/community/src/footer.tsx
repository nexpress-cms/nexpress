import { getCachedNavigation } from "@nexpress/next";

import { resolveCommunitySettings } from "./settings-helpers.js";

export async function CommunityFooter() {
  const [items, settings] = await Promise.all([
    getCachedNavigation("footer"),
    resolveCommunitySettings(),
  ]);

  return (
    <footer className="np-community-footer">
      <div className="np-community-container np-community-footer-grid">
        <div className="np-community-footer-brand">
          <strong>{settings.communityName}</strong>
          <p>{settings.footerMessage}</p>
        </div>
        {items.length > 0 ? (
          <nav className="np-community-footer-nav" aria-label="푸터 메뉴">
            {items.map((item) => (
              <a key={`${item.url}-${item.label}`} href={item.url}>
                {item.label}
              </a>
            ))}
          </nav>
        ) : null}
        <div className="np-community-footer-meta">
          <a href="/members/login">회원 로그인</a>
          <span>Powered by NexPress</span>
        </div>
      </div>
    </footer>
  );
}
