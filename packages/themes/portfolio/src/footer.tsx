import { resolvePortfolioSettings } from "./settings-helpers.js";

/**
 * Studio footer — three rows on a thin top rule:
 *   1. Contact line  (NP_SOCIAL_EMAIL → mailto, or generic blurb)
 *   2. Social mini-strip (NP_SOCIAL_GITHUB / TWITTER / LINKEDIN /
 *      MASTODON, all optional, hidden when none are configured)
 *   3. Colophon — year + framework credit, toggled by
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
