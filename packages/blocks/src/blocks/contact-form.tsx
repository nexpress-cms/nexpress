import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const parseFields = (value: unknown): string[] => {
  const fallback = ["Name", "Email", "Company"];
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

  const fields = source.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return fields.length > 0 ? fields : fallback;
};

export const contactFormBlock: NpBlockDefinition = {
  type: "contact-form",
  label: "Contact Form",
  description: "Lead capture placeholder with configurable fields and contact destination.",
  icon: "✉️",
  defaultProps: {
    heading: "Talk to our team",
    email: "hello@example.com",
    fields: JSON.stringify(["Name", "Email", "Company"], null, 2),
  },
  propsSchema: [
    { name: "heading", label: "Heading", type: "text", defaultValue: "Talk to our team" },
    { name: "email", label: "Email", type: "text", defaultValue: "hello@example.com" },
    { name: "fields", label: "Fields", type: "textarea", defaultValue: JSON.stringify(["Name", "Email", "Company"], null, 2) },
  ],
  render: (props) => {
    const heading = readString(props.heading, "Talk to our team");
    const email = readString(props.email, "hello@example.com");
    const fields = parseFields(props.fields);
    const inputStyle: CSSProperties = {
      width: "100%",
      padding: "0.9rem 1rem",
      borderRadius: "0.9rem",
      border: "1px solid rgba(15, 23, 42, 0.12)",
      background: "#ffffff",
      font: "inherit",
    };

    return (
      <section className="nx-block-contact-form" style={{ padding: "4rem 1.5rem", background: "#f1f5f9" }}>
        <div style={{ maxWidth: "40rem", margin: "0 auto", display: "grid", gap: "1.2rem" }}>
          <header style={{ display: "grid", gap: "0.5rem" }}>
            <h2 style={{ margin: 0, fontSize: "clamp(2rem, 4vw, 2.8rem)", color: "#0f172a" }}>{heading}</h2>
            <p style={{ margin: 0, color: "#475569" }}>Responses can be routed to {email} with your preferred form plugin.</p>
          </header>
          <form style={{ display: "grid", gap: "0.9rem" }}>
            {fields.map((field) => (
              <label key={field} style={{ display: "grid", gap: "0.45rem", color: "#0f172a", fontWeight: 600 }}>
                <span>{field}</span>
                <input name={field.toLowerCase().replace(/\s+/g, "-")} type="text" placeholder={field} style={inputStyle} />
              </label>
            ))}
            <label style={{ display: "grid", gap: "0.45rem", color: "#0f172a", fontWeight: 600 }}>
              <span>Message</span>
              <textarea name="message" rows={5} placeholder="Tell us more" style={{ ...inputStyle, resize: "vertical" }} />
            </label>
            <button
              type="button"
              style={{
                justifySelf: "start",
                padding: "0.9rem 1.4rem",
                borderRadius: "999px",
                border: "none",
                background: "#0f172a",
                color: "#ffffff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Submit
            </button>
          </form>
        </div>
      </section>
    );
  },
};
