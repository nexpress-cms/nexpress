"use client";

import { useEffect, useRef, useState } from "react";
import { npOpenMobileNavDialog } from "@nexpress/theme/client";

export interface CommunityNavItem {
  label: string;
  url: string;
  current?: boolean;
  children?: CommunityNavItem[];
}

export function CommunityMobileNav({ items }: { items: CommunityNavItem[] }) {
  const [open, setOpen] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open || !dialogRef.current || !triggerRef.current) return;
    return npOpenMobileNavDialog(dialogRef.current, triggerRef.current, {
      desktopQuery: "(min-width: 761px)",
      onClose: () => setOpen(false),
    });
  }, [open]);

  return (
    <div className="np-community-mobile-nav">
      <button
        ref={triggerRef}
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
        <dialog
          ref={dialogRef}
          id="np-community-mobile-menu"
          className="np-community-mobile-drawer"
          aria-label="전체 메뉴"
        >
          <div className="np-community-mobile-drawer-head">
            <strong>전체 메뉴</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="메뉴 닫기">
              ×
            </button>
          </div>
          <nav aria-label="모바일 메뉴">
            <ul className="np-community-mobile-list">
              {items.map((item) => (
                <li key={`${item.url}-${item.label}`}>
                  <a
                    href={item.url}
                    aria-current={item.current ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </a>
                  {item.children && item.children.length > 0 ? (
                    <ul className="np-community-mobile-subnav">
                      {item.children.map((child) => (
                        <li key={`${child.url}-${child.label}`}>
                          <a
                            href={child.url}
                            aria-current={child.current ? "page" : undefined}
                            onClick={() => setOpen(false)}
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
            <div className="np-community-mobile-actions">
              <a href="/blog">새 글 보기</a>
              <a href="/members/login">로그인</a>
            </div>
          </nav>
        </dialog>
      ) : null}
    </div>
  );
}
