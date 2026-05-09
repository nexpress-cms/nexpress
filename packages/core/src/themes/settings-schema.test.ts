import { describe, expect, it } from "vitest";
import { z } from "zod";

import { introspectThemeSettingsSchema } from "./settings-schema.js";

describe("introspectThemeSettingsSchema", () => {
  it("returns empty array when schema is undefined", () => {
    expect(introspectThemeSettingsSchema(undefined)).toEqual([]);
  });

  it("returns empty array when top-level is not an object", () => {
    expect(introspectThemeSettingsSchema(z.string())).toEqual([]);
  });

  it("introspects a string field as text", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({ title: z.string() }),
    );
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      name: "title",
      type: "text",
      required: true,
    });
  });

  it("detects url format", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({ link: z.string().url() }),
    );
    expect(fields[0]?.type).toBe("url");
  });

  it("detects color format via regex heuristic", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({ accent: z.string().regex(/^#[0-9a-f]{6}$/i) }),
    );
    expect(fields[0]?.type).toBe("color");
  });

  it("introspects number with constraints", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({ count: z.number().int().min(1).max(10) }),
    );
    expect(fields[0]).toMatchObject({
      name: "count",
      type: "number",
      int: true,
      min: 1,
      max: 10,
    });
  });

  it("introspects boolean", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({ enabled: z.boolean() }),
    );
    expect(fields[0]).toMatchObject({ name: "enabled", type: "boolean" });
  });

  it("introspects enum with options", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({ hero: z.enum(["featured", "carousel", "grid"]) }),
    );
    expect(fields[0]).toMatchObject({
      type: "enum",
      options: ["featured", "carousel", "grid"],
    });
  });

  it("captures default value through .default()", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({ hero: z.enum(["a", "b"]).default("a") }),
    );
    expect(fields[0]?.default).toBe("a");
    expect(fields[0]?.type).toBe("enum");
    expect(fields[0]?.required).toBe(true);
  });

  it("marks .optional() as required: false", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({ tag: z.string().optional() }),
    );
    expect(fields[0]?.required).toBe(false);
  });

  it("captures description", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({ tag: z.string().describe("A tag name") }),
    );
    expect(fields[0]?.description).toBe("A tag name");
  });

  it("introspects nested object", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({
        seo: z.object({
          title: z.string(),
          description: z.string().optional(),
        }),
      }),
    );
    expect(fields[0]?.type).toBe("object");
    if (fields[0]?.type === "object") {
      expect(fields[0].fields).toHaveLength(2);
      expect(fields[0].fields[0]?.name).toBe("title");
      expect(fields[0].fields[1]?.required).toBe(false);
    }
  });

  it("introspects array of objects", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({
        socials: z.array(
          z.object({
            platform: z.enum(["twitter", "github"]),
            url: z.string().url(),
          }),
        ),
      }),
    );
    expect(fields[0]?.type).toBe("array");
    if (fields[0]?.type === "array") {
      expect(fields[0].element).toHaveLength(2);
      expect(fields[0].element[0]?.type).toBe("enum");
      expect(fields[0].element[1]?.type).toBe("url");
    }
  });

  it("returns unsupported for non-object array element", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({ tags: z.array(z.string()) }),
    );
    expect(fields[0]?.type).toBe("unsupported");
  });

  it("returns unsupported for unrecognized types", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({ when: z.date() }),
    );
    expect(fields[0]?.type).toBe("unsupported");
  });

  it("unwraps top-level .default() wrapper around the schema", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({ tag: z.string() }).default({ tag: "" }),
    );
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ name: "tag", type: "text" });
  });

  it("unwraps top-level .optional() wrapper around the schema", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({ tag: z.string() }).optional(),
    );
    expect(fields).toHaveLength(1);
    expect(fields[0]?.name).toBe("tag");
  });

  it("emits textarea field when meta({ widget: 'textarea' }) set", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({
        bio: z.string().meta({ widget: "textarea" }).describe("Bio"),
      }),
    );
    expect(fields[0]).toMatchObject({
      name: "bio",
      type: "textarea",
    });
  });

  it("textarea field carries optional rows hint from meta", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({
        bio: z.string().meta({ widget: "textarea", rows: 6 }),
      }),
    );
    expect(fields[0]).toMatchObject({
      name: "bio",
      type: "textarea",
      rows: 6,
    });
  });

  it("textarea unwraps through .default() and .optional()", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({
        bio: z
          .string()
          .meta({ widget: "textarea" })
          .default(""),
      }),
    );
    expect(fields[0]?.type).toBe("textarea");
  });

  it("ignores meta when widget isn't 'textarea'", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({
        tag: z.string().meta({ something: "else" }),
      }),
    );
    expect(fields[0]?.type).toBe("text");
  });

  it("detects textarea when .meta() is the LAST link in the chain (after .optional())", () => {
    // .meta() last — Zod v4 returns a new instance for .meta(),
    // so meta lives on the OUTER optional, not the inner string.
    // Both author conventions must produce textarea:
    //   z.string().meta({...}).optional()
    //   z.string().optional().meta({...})
    const fields = introspectThemeSettingsSchema(
      z.object({
        bio: z
          .string()
          .optional()
          .meta({ widget: "textarea", rows: 8 }),
      }),
    );
    expect(fields[0]).toMatchObject({
      name: "bio",
      type: "textarea",
      rows: 8,
    });
  });

  // G.1 — sensitive widget hint for password / secret fields.
  it("emits password field when meta({ sensitive: true }) is set", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({
        clientSecret: z
          .string()
          .min(1)
          .meta({ sensitive: true })
          .describe("OAuth client secret"),
      }),
    );
    expect(fields[0]).toMatchObject({
      name: "clientSecret",
      type: "password",
    });
  });

  it("password takes precedence over textarea hint", () => {
    // A field that's BOTH sensitive AND multi-line is unusual but
    // possible (e.g. PEM private keys). Sensitive wins because the
    // masking guarantee matters more than the line-count UX.
    const fields = introspectThemeSettingsSchema(
      z.object({
        privateKey: z
          .string()
          .meta({ sensitive: true, widget: "textarea", rows: 6 }),
      }),
    );
    expect(fields[0]?.type).toBe("password");
  });

  it("password unwraps through .optional() and .default()", () => {
    const fields = introspectThemeSettingsSchema(
      z.object({
        token: z
          .string()
          .meta({ sensitive: true })
          .optional()
          .default(""),
      }),
    );
    expect(fields[0]?.type).toBe("password");
  });
});
