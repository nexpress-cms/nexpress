import * as React from "react";

interface NxMarkProps {
  size?: number;
  className?: string;
  beamColor?: string;
}

/**
 * NexPress wordmark — geometric N composed of three paths:
 * a blue notch on the upper-right (`#0066FF`), a black diagonal beam,
 * and a black foot on the lower-left. `currentColor` carries the foot +
 * beam so the mark flips correctly on dark surfaces.
 */
export function NxMark({ size = 22, className, beamColor }: NxMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      style={{ display: "block", color: beamColor }}
      aria-label="NexPress"
    >
      <path d="M28 0 L64 0 L64 36 L52 24 L52 12 L40 12 Z" fill="#0066FF" />
      <path d="M0 24 L24 48 L24 64 L0 64 Z" fill="currentColor" />
      <path d="M0 0 L20 0 L64 44 L64 64 L44 64 L0 20 Z" fill="currentColor" />
    </svg>
  );
}
