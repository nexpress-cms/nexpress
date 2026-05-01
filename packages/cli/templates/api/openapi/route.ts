import { getAllCollectionSlugs, getCollectionConfig } from "@nexpress/core";
import { NextResponse } from "next/server";

import { ensureFor } from "@/lib/bootstrap";
import { collectionToManifest, type NxFieldManifest } from "@/lib/manifest";

type OpenApiSchema = Record<string, unknown>;

function fieldToSchema(field: NxFieldManifest): OpenApiSchema {
  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "select":
    case "radio":
      return { type: "string", ...(field.options && { enum: field.options.map((o) => o.value) }) };
    case "number":
      return { type: field.integerOnly ? "integer" : "number" };
    case "checkbox":
      return { type: "boolean" };
    case "date":
      return { type: "string", format: "date-time" };
    case "richText":
    case "blocks":
    case "json":
      return { type: "object", additionalProperties: true };
    case "upload":
    case "relationship":
      return field.hasMany
        ? { type: "array", items: { type: "string", format: "uuid" } }
        : { type: "string", format: "uuid" };
    default:
      return { type: "object", additionalProperties: true };
  }
}

function collectionSchema(manifest: ReturnType<typeof collectionToManifest>): OpenApiSchema {
  const properties: Record<string, OpenApiSchema> = {
    id: { type: "string", format: "uuid", readOnly: true },
    status: { type: "string", enum: ["draft", "published", "archived"] },
    createdAt: { type: "string", format: "date-time", readOnly: true },
    updatedAt: { type: "string", format: "date-time", readOnly: true },
  };
  for (const field of manifest.fields) {
    if (field.type === "row" || field.type === "collapsible") continue;
    properties[field.name] = {
      ...fieldToSchema(field),
      ...(field.description && { description: field.description }),
    };
  }
  if (manifest.slug_auto) {
    properties.slug = { type: "string", description: "Auto-derived unless provided." };
  }
  return { type: "object", properties };
}

export async function GET() {
  await ensureFor("read");
  const slugs = getAllCollectionSlugs();
  const schemas: Record<string, OpenApiSchema> = {};
  const paths: Record<string, OpenApiSchema> = {
    "/api/auth/login": { post: { summary: "Log in" } },
    "/api/auth/logout": { post: { summary: "Log out" } },
    "/api/auth/me": { get: { summary: "Current user" } },
  };
  for (const slug of slugs) {
    const manifest = collectionToManifest(getCollectionConfig(slug));
    const schemaName = `${slug}_document`;
    schemas[schemaName] = collectionSchema(manifest);
    paths[`/api/collections/${slug}`] = { get: { summary: `List ${manifest.labels.plural}` } };
    paths[`/api/collections/${slug}/{id}`] = { get: { summary: `Get ${manifest.labels.singular}` } };
  }
  return NextResponse.json(
    {
      openapi: "3.1.0",
      info: { title: "NexPress API", version: "0.1.0" },
      servers: [{ url: process.env.SITE_URL ?? "http://localhost:3000" }],
      components: { schemas },
      paths,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
