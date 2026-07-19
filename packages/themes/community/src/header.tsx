import { getCachedNavigation } from "@nexpress/next";

import { CommunityMobileNav, type CommunityNavItem } from "./components/mobile-nav.js";
import { resolveCommunitySettings } from "./settings-helpers.js";

function isCurrent(itemUrl: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (itemUrl === pathname) return true;
  return itemUrl !== "/" && pathname.startsWith(`${itemUrl}/`);
}

export async function CommunityHeader() {
  const [items, settings] = await Promise.all([
    getCachedNavigation("header"),
    resolveCommunitySettings(),
  ]);
  let pathname: string | null = null;
  try {
    const { headers } = await import("next/headers");
    pathname = (await headers()).get("x-np-pathname");
  } catch {
    // CLI/module probes run outside a Next request scope.
  }

  const mobileItems: CommunityNavItem[] = items.map((item) => ({
    label: item.label,
    url: item.url,
    children: item.children?.map((child) => ({ label: child.label, url: child.url })),
  }));

  return (
    <header className="np-community-header">
      {settings.showUtilityBar ? (
        <div className="np-community-utility">
          <div className="np-community-container np-community-utility-inner">
            <span>오늘도 반가워요. 함께 좋은 이야기를 만들어요.</span>
            <nav aria-label="회원 바로가기">
              <a href="/blog">새 글</a>
              <a href="/members/me/notifications">알림</a>
              <a href="/members/login">로그인</a>
            </nav>
          </div>
        </div>
      ) : null}
      <div className="np-community-brand-row">
        <div className="np-community-container np-community-brand-inner">
          <a className="np-community-brand" href="/">
            <span className="np-community-brand-mark" aria-hidden="true">
              N
            </span>
            <span className="np-community-brand-copy">
              <strong>{settings.communityName}</strong>
              <small>{settings.tagline}</small>
            </span>
          </a>
          <a className="np-community-search-link" href="/blog" aria-label="모든 글 보기">
            <span aria-hidden="true">⌕</span>
            <span>글 모아보기</span>
          </a>
        </div>
      </div>
      <div className="np-community-nav-bar">
        <div className="np-community-container np-community-nav-inner">
          <nav className="np-community-desktop-nav" aria-label="주 메뉴">
            <ul>
              {items.map((item) => (
                <li key={`${item.url}-${item.label}`}>
                  <a
                    href={item.url}
                    aria-current={isCurrent(item.url, pathname) ? "page" : undefined}
                  >
                    {item.label}
                  </a>
                  {item.children && item.children.length > 0 ? (
                    <ul className="np-community-subnav">
                      {item.children.map((child) => (
                        <li key={`${child.url}-${child.label}`}>
                          <a
                            href={child.url}
                            aria-current={isCurrent(child.url, pathname) ? "page" : undefined}
                          >
                            {child.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </nav>
          <CommunityMobileNav items={mobileItems} />
          <a className="np-community-write-link" href="/members/register">
            가입하기
          </a>
        </div>
      </div>
    </header>
  );
}
