import {
  npValidateRenderContribution,
  type NpBodyEntry,
  type NpHeadEntry,
  type NpRenderContribution,
} from "@nexpress/plugin-sdk";
import { runHookAndCollect } from "@nexpress/core";

/**
 * Fires the `render:beforePage` hook against every registered plugin and
 * collects their `NpRenderContribution` returns into a single flattened
 * pair. The data argument becomes the hook's `data` object — plugins read
 * `{ collection, slug, document }` to compute per-document output.
 */
export async function collectRenderContributions(data: {
  collection: string;
  slug: string;
  document: Record<string, unknown>;
}): Promise<{ head: NpHeadEntry[]; bodyEnd: NpBodyEntry[] }> {
  const contributions = await runHookAndCollect<NpRenderContribution>(
    "render:beforePage",
    {
      collection: data.collection,
      slug: data.slug,
      document: data.document,
    },
    {
      validateResult: npValidateRenderContribution,
    },
  );

  const head: NpHeadEntry[] = [];
  const bodyEnd: NpBodyEntry[] = [];
  for (const entry of contributions) {
    if (!entry || typeof entry !== "object") continue;
    if (Array.isArray(entry.head)) head.push(...entry.head);
    if (Array.isArray(entry.bodyEnd)) bodyEnd.push(...entry.bodyEnd);
  }
  return { head, bodyEnd };
}

/**
 * Renders plugin-contributed head and body-end tags inline. React 19 hoists
 * `<meta>`, `<link>`, `<title>`, and `<style>` into the document head, so
 * the component can live anywhere in the page tree. Body-end scripts are
 * emitted in place — render the `<RenderBodyEnd>` sibling near the end of
 * your page JSX if order matters.
 *
 * Inline `<script>` children are injected via `dangerouslySetInnerHTML` —
 * plugins in v1 are trusted code (see capability model).
 */
export function RenderHead({ entries }: { entries: NpHeadEntry[] }) {
  if (entries.length === 0) return null;
  return <>{entries.map((entry, index) => renderHeadEntry(entry, index))}</>;
}

export function RenderBodyEnd({ entries }: { entries: NpBodyEntry[] }) {
  if (entries.length === 0) return null;
  return <>{entries.map((entry, index) => renderBodyEntry(entry, index))}</>;
}

function renderHeadEntry(entry: NpHeadEntry, key: number) {
  switch (entry.tag) {
    case "meta":
      return <meta key={key} {...entry.attrs} />;
    case "link":
      return <link key={key} {...entry.attrs} />;
    case "script":
      return entry.children ? (
        <script
          key={key}
          {...(entry.attrs ?? {})}
          dangerouslySetInnerHTML={{ __html: entry.children }}
        />
      ) : (
        <script key={key} {...(entry.attrs ?? {})} />
      );
    case "style":
      return (
        <style
          key={key}
          {...(entry.attrs ?? {})}
          dangerouslySetInnerHTML={{ __html: entry.children }}
        />
      );
    default:
      return null;
  }
}

function renderBodyEntry(entry: NpBodyEntry, key: number) {
  switch (entry.tag) {
    case "script":
      return entry.children ? (
        <script
          key={key}
          {...(entry.attrs ?? {})}
          dangerouslySetInnerHTML={{ __html: entry.children }}
        />
      ) : (
        <script key={key} {...(entry.attrs ?? {})} />
      );
    case "noscript":
      return <noscript key={key} dangerouslySetInnerHTML={{ __html: entry.children }} />;
    default:
      return null;
  }
}
