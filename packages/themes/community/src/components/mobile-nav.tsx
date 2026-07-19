"use client";

import { useState } from "react";

export interface CommunityNavItem {
  label: string;
  url: string;
  children?: CommunityNavItem[];
}

export function CommunityMobileNav({ items }: { items: CommunityNavItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="np-community-mobile-nav">
      <button
        type="button"
        className="np-community-mobile-toggle"
        aria-expanded={open}
        aria-controls="np-community-mobile-menu"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">{open ? "×" : "☰"}</span>
        <span>{open ? "메뉴 닫기" : "전체 메뉴"}</span>
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="np-community-mobile-backdrop"
            aria-label="메뉴 닫기"
            onClick={() => setOpen(false)}
          />
          <nav
            id="np-community-mobile-menu"
            className="np-community-mobile-drawer"
            aria-label="모바일 메뉴"
          >
            <div className="np-community-mobile-drawer-head">
              <strong>전체 메뉴</strong>
              <button type="button" onClick={() => setOpen(false)} aria-label="메뉴 닫기">
                ×
              </button>
            </div>
            <ul className="np-community-mobile-list">
              {items.map((item) => (
                <li key={`${item.url}-${item.label}`}>
                  <a href={item.url} onClick={() => setOpen(false)}>
                    {item.label}
                  </a>
                  {item.children && item.children.length > 0 ? (
                    <ul className="np-community-mobile-subnav">
                      {item.children.map((child) => (
                        <li key={`${child.url}-${child.label}`}>
                          <a href={child.url} onClick={() => setOpen(false)}>
                            {child.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="np-community-mobile-actions">
              <a href="/blog">새 글 보기</a>
              <a href="/members/login">로그인</a>
            </div>
          </nav>
        </>
      ) : null}
    </div>
  );
}
