import type { NpTemplateRenderProps } from "@nexpress/theme";

const PRESS_ITEMS = [
  {
    outlet: "Design Observer",
    title: "A studio that still believes in the long brief",
    year: "2026",
  },
  {
    outlet: "Eye Magazine",
    title: "Owen & Spruce on custom type for civic systems",
    year: "2025",
  },
  {
    outlet: "Brand New",
    title: "The quiet confidence of the Hanmi Gallery identity",
    year: "2025",
  },
  {
    outlet: "It's Nice That",
    title: "Field Notebooks finds a second spine",
    year: "2024",
  },
];

export function PagePressTemplate(_props: NpTemplateRenderProps) {
  return (
    <article className="np-portfolio-press-page">
      <section className="np-portfolio-subpage-hero np-portfolio-container">
        <p>Press</p>
        <h1>Selected coverage, interviews, and awards.</h1>
        <div>
          <p>
            A short public record of conversations and notices around the studio. For press
            requests, interviews, and image licensing, write to hello@owenandspruce.test.
          </p>
        </div>
      </section>

      <section className="np-portfolio-container">
        <ul className="np-portfolio-press-list">
          {PRESS_ITEMS.map((item) => (
            <li key={`${item.outlet}-${item.year}`}>
              <span>{item.year}</span>
              <div>
                <p>{item.outlet}</p>
                <h2>{item.title}</h2>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
