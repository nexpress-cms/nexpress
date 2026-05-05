import * as React from "react";
import { Lock } from "lucide-react";

import { NxMark } from "../layout/nx-mark.js";
import { cn } from "../ui/utils.js";

interface AuthLayoutProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Full-bleed auth-page layout (login, forgot-password, set-password,
 * setup wizard). Soft brand-blue radial vignette over the warm-paper
 * background so the centered card feels intentional without competing
 * with the form copy.
 */
export function AuthLayout({ children, className }: AuthLayoutProps) {
  return (
    <div
      className={cn(
        "grid min-h-screen place-items-center px-5 py-10",
        "bg-[radial-gradient(circle_at_15%_0%,rgba(0,102,255,0.06),transparent_50%),radial-gradient(circle_at_85%_100%,rgba(0,102,255,0.04),transparent_50%),#f8f8f7]",
        "dark:bg-[radial-gradient(circle_at_15%_0%,rgba(0,102,255,0.10),transparent_50%),radial-gradient(circle_at_85%_100%,rgba(0,102,255,0.06),transparent_50%),#0a0a0a]",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface AuthCardProps {
  title: string;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * The card itself: NxMark + wordmark, title, description, body, and an
 * optional footer. Intentionally narrow (max-w-sm) — wider forms read
 * as marketing pages, not as auth.
 */
export function AuthCard({
  title,
  description,
  footer,
  children,
  className,
}: AuthCardProps) {
  return (
    <div
      className={cn(
        "w-full max-w-[380px] rounded-xl border border-neutral-200/70 bg-white px-7 pt-7 pb-5 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.12),0_8px_16px_-8px_rgba(0,0,0,0.06)] dark:border-neutral-800/70 dark:bg-neutral-950 dark:shadow-[0_20px_50px_-20px_rgba(0,0,0,0.5)]",
        className,
      )}
    >
      <div className="mb-5 flex items-center gap-3">
        <NxMark size={28} />
        <span className="text-[16px] font-semibold tracking-[-0.01em] text-neutral-950 dark:text-neutral-50">
          NexPress
        </span>
      </div>
      <h1 className="text-[22px] font-semibold leading-[1.15] tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">
        {title}
      </h1>
      {description ? (
        <p className="mt-1 mb-5 text-[13.5px] leading-[1.5] text-neutral-500 dark:text-neutral-400">
          {description}
        </p>
      ) : (
        <div className="mb-4" />
      )}
      <div className="flex flex-col gap-3">{children}</div>
      {footer ? (
        <div className="mt-5 flex items-center justify-between border-t border-neutral-200/70 pt-3.5 text-[12px] text-neutral-500 dark:border-neutral-800/70 dark:text-neutral-400">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The default footer used on most auth pages — version pill on the left,
 * "Argon2 + JWT" reassurance on the right. Pages can override via
 * <AuthCard footer={...} /> when a specific page wants something else.
 */
export function AuthCardDefaultFooter() {
  return (
    <>
      <span className="font-mono">v0.1.0 · pre-1.0</span>
      <span className="inline-flex items-center gap-1">
        <Lock className="size-3" />
        Argon2 + JWT
      </span>
    </>
  );
}

interface AuthDividerProps {
  children?: React.ReactNode;
}

/**
 * "or" divider between OAuth buttons and the email/password form. Pure
 * presentation — no semantic meaning.
 */
export function AuthDivider({ children = "or" }: AuthDividerProps) {
  return (
    <div className="flex items-center gap-2.5 my-1 text-[11px] uppercase tracking-[0.18em] text-neutral-400">
      <span aria-hidden className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
      <span>{children}</span>
      <span aria-hidden className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
    </div>
  );
}
