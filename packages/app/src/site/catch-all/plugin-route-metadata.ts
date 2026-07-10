import { type Metadata } from "next";

export function npApplyPluginPageRouteLocaleMetadata(
  metadata: Metadata,
  locale: "auto" | "none",
  languages: Readonly<Record<string, string>>,
  xDefault: string,
): Metadata {
  if (locale === "none") return metadata;
  return {
    ...metadata,
    alternates: {
      ...(metadata.alternates ?? {}),
      languages: {
        ...languages,
        "x-default": xDefault,
      },
    },
  };
}
