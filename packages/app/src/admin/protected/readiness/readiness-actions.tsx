"use client";

import { useEffect, useState } from "react";
import { Button } from "@nexpress/admin/client";

type CopyState = "idle" | "copied" | "failed";

interface CopyCommandButtonProps {
  command: string;
  label?: string;
  className?: string;
}

export function CopyCommandButton({ command, label = "Copy", className }: CopyCommandButtonProps) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timeout = window.setTimeout(() => {
      setState("idle");
    }, 1600);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      onClick={() => void copy()}
      aria-label={`${label} command`}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </Button>
  );
}
