import * as React from "react";

interface NpMarkProps {
  size?: number;
  className?: string;
  beamColor?: string;
}

/**
 * NexPress mark — geometric N composed of three paths:
 * a blue notch on the upper-right (`#0066FF`), a black diagonal beam,
 * and a black foot on the lower-left. `currentColor` carries the foot +
 * beam so the mark flips correctly on dark surfaces.
 */
export function NpMark({ size = 22, className, beamColor }: NpMarkProps) {
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
      <path d="M28 0H64V36L52 24V12H40L28 0Z" fill="#0066FF" />
      <path d="M0 24L24 48V64H0V24Z" fill="currentColor" />
      <path d="M0 0H18L64 46V64H46L0 18V0Z" fill="currentColor" />
    </svg>
  );
}
