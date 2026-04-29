export function PortfolioFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="nx-site-footer nx-portfolio-footer">
      <p className="nx-portfolio-footer-mark">
        © {year} · Built with NexPress
      </p>
    </footer>
  );
}
