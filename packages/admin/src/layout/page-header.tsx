import * as React from "react";

import { cn } from "../ui/utils.js";

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Refined page header used across admin views (Dashboard, Settings,
 * Plugins, Sites, Members, Reports, Jobs, …). No tracked eyebrow; the
 * topbar's breadcrumbs already carry the section context. Title is
 * `text-[22px] font-semibold tracking-[-0.02em]`; description sits
 * underneath in `text-[13.5px]`. Optional `actions` slot renders to
 * the right (or wraps below on mobile).
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[22px] font-semibold leading-[1.15] tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">
          {title}
        </h1>
        {description ? (
          <p className="max-w-[64ch] text-[13.5px] text-neutral-500 dark:text-neutral-400">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
