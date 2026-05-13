import type { Metadata } from "next";

// Opt into `<meta name="referrer" content="no-referrer">` so the reset token
// in the URL isn't leaked via Referer to any sub-request — even same-origin
// ones (analytics, fonts, images that might be added later).
export const metadata: Metadata = {
  referrer: "no-referrer",
};

export { default } from "@nexpress/app/admin/set-password/page";
