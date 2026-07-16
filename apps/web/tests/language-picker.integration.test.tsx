import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// This suite runs with `isolate: false`; themes may already have imported the
// component with Next's real navigation module in the same worker. Reload the
// module graph after installing these focused mocks.
vi.resetModules();

const { usePathname } = await import("next/navigation");
const { LanguagePicker } =
  await import("../../../packages/themes/default/src/components/language-picker.js");

/**
 * Phase 12.6a — visitor-facing language picker. Tests pin the
 * URL-rewriting + active-locale logic so future refactors
 * don't quietly drop the locale-prefix-replacement behavior
 * (which is the whole point of the picker).
 */
describe("LanguagePicker", () => {
  function setPath(path: string) {
    vi.mocked(usePathname).mockReturnValue(path);
  }

  it("renders one link per configured locale", () => {
    setPath("/en/blog/hello");
    const html = renderToStaticMarkup(<LanguagePicker locales={["en", "ko", "ja"]} />);
    expect((html.match(/<a /g) ?? []).length).toBe(3);
  });

  it("replaces a known locale prefix with the picked locale", () => {
    setPath("/en/blog/hello");
    const html = renderToStaticMarkup(<LanguagePicker locales={["en", "ko"]} />);
    expect(html).toContain('href="/ko/blog/hello"');
    expect(html).toContain('href="/en/blog/hello"');
  });

  it("prepends the locale prefix when the URL has no known locale", () => {
    setPath("/some/path");
    const html = renderToStaticMarkup(<LanguagePicker locales={["en", "ko"]} />);
    expect(html).toContain('href="/en/some/path"');
    expect(html).toContain('href="/ko/some/path"');
  });

  it("handles the bare site root", () => {
    setPath("/");
    const html = renderToStaticMarkup(<LanguagePicker locales={["en", "ko"]} />);
    expect(html).toContain('href="/en"');
    expect(html).toContain('href="/ko"');
  });

  it("marks the current locale active via aria-current + data-active", () => {
    setPath("/ko/about");
    const html = renderToStaticMarkup(<LanguagePicker locales={["en", "ko"]} />);
    // aria-current + data-active attributes present on the
    // matching link
    const koMatch = html.match(/<a [^>]*href="\/ko\/about"[^>]*>/);
    expect(koMatch?.[0]).toContain('aria-current="true"');
    expect(koMatch?.[0]).toContain('data-active="true"');
    // English link must NOT have them
    const enMatch = html.match(/<a [^>]*href="\/en\/about"[^>]*>/);
    expect(enMatch?.[0]).not.toContain("aria-current");
    expect(enMatch?.[0]).not.toContain("data-active");
  });

  it("formats labels via formatLabel when provided", () => {
    setPath("/en");
    const html = renderToStaticMarkup(
      <LanguagePicker
        locales={["en", "ko"]}
        formatLabel={(loc) => (loc === "ko" ? "한국어" : "English")}
      />,
    );
    expect(html).toContain(">English<");
    expect(html).toContain(">한국어<");
  });

  it("falls back to the upper-cased locale code when no formatter", () => {
    setPath("/en");
    const html = renderToStaticMarkup(<LanguagePicker locales={["en", "pt-BR"]} />);
    expect(html).toContain(">EN<");
    expect(html).toContain(">PT-BR<");
  });

  it("emits hreflang attribute matching each link's locale", () => {
    setPath("/en/blog");
    const html = renderToStaticMarkup(<LanguagePicker locales={["en", "ko"]} />);
    expect(html).toMatch(/<a [^>]*href="\/ko\/blog"[^>]*hrefLang="ko"/);
    expect(html).toMatch(/<a [^>]*href="\/en\/blog"[^>]*hrefLang="en"/);
  });

  it("renders locales not in `availableLocales` as a disabled span (Sprint S)", () => {
    setPath("/en/about");
    const html = renderToStaticMarkup(
      <LanguagePicker locales={["en", "ko", "ja"]} availableLocales={["en", "ko"]} />,
    );
    // en + ko stay as <a>
    expect(html).toMatch(/<a [^>]*href="\/en\/about"/);
    expect(html).toMatch(/<a [^>]*href="\/ko\/about"/);
    // ja becomes a disabled <span>
    expect(html).toMatch(/<span[^>]*aria-disabled="true"[^>]*>JA<\/span>/);
    expect(html).not.toMatch(/<a [^>]*href="\/ja\/about"/);
  });

  it("leaves every locale enabled when availableLocales is omitted", () => {
    setPath("/en/about");
    const html = renderToStaticMarkup(<LanguagePicker locales={["en", "ko", "ja"]} />);
    expect((html.match(/<a /g) ?? []).length).toBe(3);
    expect(html).not.toMatch(/aria-disabled/);
  });
});
