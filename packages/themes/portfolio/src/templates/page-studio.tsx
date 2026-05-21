import type { NpTemplateRenderProps } from "@nexpress/theme";

const PEOPLE = [
  {
    name: "Owen Park",
    role: "Creative direction",
    note: "Identity systems, naming frames, and the last pass on every deck.",
  },
  {
    name: "Mina Spruce",
    role: "Type and editorial",
    note: "Custom display cuts, book systems, and the studio's print spine.",
  },
  {
    name: "Jules Han",
    role: "Strategy",
    note: "Positioning, interviews, launch sequencing, and client workshops.",
  },
  {
    name: "Noah Vale",
    role: "Digital systems",
    note: "Web direction, interaction details, and production handoff.",
  },
];

const SERVICES = [
  "Identity and naming",
  "Custom type",
  "Editorial systems",
  "Packaging",
  "Environmental graphics",
  "Digital art direction",
];

export function PageStudioTemplate(_props: NpTemplateRenderProps) {
  return (
    <article className="np-portfolio-studio-page">
      <section className="np-portfolio-subpage-hero np-portfolio-container">
        <p>Studio</p>
        <h1>Five people, four engagements a year, one long view.</h1>
        <div>
          <p>
            Owen & Spruce works at the intersection of identity, custom type, and editorial design.
            The studio was founded in 2018 in a converted printer's shop in Mapo, Seoul; a second
            desk opened in New York in 2024.
          </p>
          <p>
            We work with brands at the inflection: when the way they look needs to catch up to who
            they have become. That usually means an identity refresh, sometimes a full rebrand, and
            occasionally a one-off display cut drawn for a single use.
          </p>
        </div>
      </section>

      <section className="np-portfolio-container np-portfolio-studio-services">
        <p>What we make</p>
        <ul>
          {SERVICES.map((service) => (
            <li key={service}>{service}</li>
          ))}
        </ul>
      </section>

      <section className="np-portfolio-container">
        <ul className="np-portfolio-studio-people">
          {PEOPLE.map((person) => (
            <li key={person.name} className="np-portfolio-studio-person">
              <p>{person.role}</p>
              <h2>{person.name}</h2>
              <span>{person.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
