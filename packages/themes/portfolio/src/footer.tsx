import { resolvePortfolioSettings } from "./settings-helpers.js";

/**
 * Studio footer — rows on a thin top rule:
 *   1. Optional bio (`settings.aboutCopy`) — short studio
 *      description rendered above the contact line. Operators
 *      who want a fuller about page do that through the page
 *      builder; this is the ambient bio surfaced on every page.
 *   2. Contact line  (NP_SOCIAL_EMAIL → mailto, or generic blurb)
 *   3. Social mini-strip (NP_SOCIAL_GITHUB / TWITTER / LINKEDIN /
 *      MASTODON, all optional, hidden when none are configured)
 *   4. Colophon — year + framework credit, toggled by
 *      `settings.showFooterCredit`. `settings.copyrightYear`
 *      overrides the auto-detected year (some studios pin to
 *      "2024" for an "established" feel).
 *
 * Stays minimal so the visual focus stays on the work above.
 */
export async function PortfolioFooter() {
  const settings = await resolvePortfolioSettings();
  const year = settings.copyrightYear ?? new Date().getFullYear();
  const email = process.env.NP_SOCIAL_EMAIL;
  const social = [
    { href: process.env.NP_SOCIAL_GITHUB, label: "GitHub" },
    { href: process.env.NP_SOCIAL_TWITTER, label: "Twitter" },
    { href: process.env.NP_SOCIAL_LINKEDIN, label: "LinkedIn" },
    { href: process.env.NP_SOCIAL_MASTODON, label: "Mastodon" },
    { href: process.env.NP_SOCIAL_DRIBBBLE, label: "Dribbble" },
    { href: process.env.NP_SOCIAL_INSTAGRAM, label: "Instagram" },
  ].filter((s): s is { href: string; label: string } => Boolean(s.href));
  const studio = settings.studioName;

  return (
    <footer className="np-site-footer np-portfolio-footer">
      <div className="np-portfolio-footer-inner">
        {settings.aboutCopy.length > 0 ? (
          <p
            className="np-portfolio-footer-bio"
            style={{
              maxWidth: "60ch",
              fontSize: "0.875rem",
              color: "var(--np-color-muted-foreground)",
              margin: "0 0 1.25rem",
            }}
          >
            {settings.aboutCopy}
          </p>
        ) : null}
        <div className="np-portfolio-footer-contact">
          {email ? (
            <a
              href={email.startsWith("mailto:") ? email : `mailto:${email}`}
              className="np-portfolio-footer-email"
            >
              {email.replace(/^mailto:/, "")}
            </a>
          ) : (
            <span className="np-portfolio-footer-email">Available for select work</span>
          )}
        </div>
        {social.length > 0 ? (
          <ul className="np-portfolio-footer-social">
            {social.map((s) => (
              <li key={s.href}>
                <a href={s.href} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="np-portfolio-footer-mark">
          © {year.toString()} · {studio}
          {settings.showFooterCredit ? " · Built with NexPress" : ""}
        </p>
      </div>
    </footer>
  );
}
