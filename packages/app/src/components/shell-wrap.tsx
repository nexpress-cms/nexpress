import { getCachedActiveTheme } from "../lib/cached-theme";

interface ShellWrapProps {
  /**
   * `"site"` (public-site default) reads `impl.shell`.
   * `"member"` reads `impl.members.shell` with the
   * F-track-locked fallback chain (null → opt out, undefined →
   * fall back to top shell + chrome slots, both absent →
   * fragment).
   */
  surface: "site" | "member";
  children: React.ReactNode;
}

/**
 * Page-level chrome wrap. Picks the right shell + header +
 * footer slots from the active theme based on `surface`, and
 * wraps `children` in `<main className="np-{surface}-main">`.
 *
 * Lives at the page level (not the layout) so a single catch-
 * all file can render different chrome depending on which
 * plugin route surface matched — `(site)/[[...slug]]` dispatches
 * `surface: "member"` plugin routes (`/boards/:boardKey/new`,
 * `/boards/:boardKey/:postId/edit` for the forum plugin) into the
 * member shell without forcing a parallel `(member)/[[...slug]]`
 * file route (which Next.js wouldn't let coexist with the site
 * catch-all anyway).
 *
 * Trade-off: every page in `(site)` and `(member)` must wrap
 * itself. A page that forgets renders bare body without chrome
 * — a visible regression. The layouts emit `NpThemeStyle` +
 * theme CSS + (site only) feed-discovery link unconditionally,
 * so theme tokens / CSS / feed metadata DON'T require the wrap.
 */
export async function ShellWrap({ surface, children }: ShellWrapProps) {
  const active = await getCachedActiveTheme();

  // Shell selection mirrors the F-track member-surface contract
  // (#581) — see `docs/design/member-surface-skinning.md` § 5.1.
  // Member-side fallback chain:
  //   1. `impl.members.shell` truthy → use it (theme owns its
  //      own member chrome).
  //   2. `impl.members.shell === null` → opt out (bare body,
  //      no header/footer slots either).
  //   3. `impl.members.shell === undefined` → fall back to top
  //      `impl.shell`. Include header/footer slots so themes
  //      whose `impl.shell` opens a `<body>` wrapper still see
  //      the chrome they expect.
  //   4. Both absent → fragment.
  let Shell: NonNullable<typeof active>["impl"]["shell"] | null;
  let includeChromeSlots: boolean;
  if (surface === "member") {
    const memberShell = active?.impl.members?.shell;
    if (memberShell === null) {
      Shell = null;
      includeChromeSlots = false;
    } else if (memberShell !== undefined) {
      Shell = memberShell;
      includeChromeSlots = false;
    } else {
      Shell = active?.impl.shell ?? null;
      includeChromeSlots = true;
    }
  } else {
    Shell = active?.impl.shell ?? null;
    includeChromeSlots = true;
  }

  const Header = includeChromeSlots ? active?.impl.slots?.header : undefined;
  const Footer = includeChromeSlots ? active?.impl.slots?.footer : undefined;

  const inner = (
    <>
      {Header ? <Header /> : null}
      <main className={surface === "member" ? "np-member-main" : "np-site-main"}>{children}</main>
      {Footer ? <Footer /> : null}
    </>
  );

  return Shell ? <Shell>{inner}</Shell> : inner;
}
