import type { NpBlockDefinition } from "../types.js";

interface FaqItem {
  question: string;
  answer: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const parseFaqItems = (value: unknown): FaqItem[] => {
  const fallback: FaqItem[] = [
    { question: "How do blocks work?", answer: "Each block definition controls its schema, default props, and server-rendered output." },
    { question: "Can editors reorder sections?", answer: "Yes. The page editor supports drag-and-drop plus keyboard-friendly reordering controls." },
    { question: "Do blocks support SSR?", answer: "Yes. All default blocks render to plain React elements that work on the server." },
  ];

  const source = typeof value === "string" ? (() => {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed;
    } catch {
      return fallback;
    }
  })() : value;

  if (!Array.isArray(source)) {
    return fallback;
  }

  const items = source
    .filter(isRecord)
    .map((item) => ({
      question: readString(item.question, "Question"),
      answer: readString(item.answer, "Answer"),
    }));

  return items.length > 0 ? items : fallback;
};

export const faqBlock: NpBlockDefinition = {
  type: "faq",
  label: "FAQ",
  description: "Expandable questions and answers for support, sales, or onboarding content.",
  icon: "❓",
  defaultProps: {
    heading: "Frequently asked questions",
    items: JSON.stringify(
      [
        { question: "How do blocks work?", answer: "Each block definition controls its schema, default props, and server-rendered output." },
        { question: "Can editors reorder sections?", answer: "Yes. The page editor supports drag-and-drop plus keyboard-friendly reordering controls." },
        { question: "Do blocks support SSR?", answer: "Yes. All default blocks render to plain React elements that work on the server." },
      ],
      null,
      2,
    ),
  },
  propsSchema: [
    { name: "heading", label: "Heading", type: "text", defaultValue: "Frequently asked questions" },
    {
      name: "items",
      label: "Items",
      type: "textarea",
      defaultValue: JSON.stringify(
        [
          { question: "How do blocks work?", answer: "Each block definition controls its schema, default props, and server-rendered output." },
          { question: "Can editors reorder sections?", answer: "Yes. The page editor supports drag-and-drop plus keyboard-friendly reordering controls." },
          { question: "Do blocks support SSR?", answer: "Yes. All default blocks render to plain React elements that work on the server." },
        ],
        null,
        2,
      ),
    },
  ],
  render: (props) => {
    const heading = readString(props.heading, "Frequently asked questions");
    const items = parseFaqItems(props.items);

    return (
      <section className="nx-block-faq" style={{ padding: "4rem 1.5rem", background: "#fffdf7" }}>
        <div style={{ maxWidth: "56rem", margin: "0 auto", display: "grid", gap: "1rem" }}>
          <h2 style={{ margin: "0 0 1rem", fontSize: "clamp(2rem, 4vw, 2.8rem)", color: "#111827" }}>{heading}</h2>
          {items.map((item) => (
            <details
              key={item.question}
              className="nx-block-faq__item"
              style={{
                borderRadius: "1rem",
                border: "1px solid rgba(17, 24, 39, 0.12)",
                background: "#ffffff",
                padding: "1rem 1.2rem",
              }}
            >
              <summary style={{ cursor: "pointer", fontWeight: 700, color: "#111827" }}>{item.question}</summary>
              <p style={{ margin: "0.9rem 0 0", lineHeight: 1.7, color: "#4b5563" }}>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>
    );
  },
};
