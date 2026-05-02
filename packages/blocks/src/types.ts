import type { ReactElement, ReactNode } from "react";

export interface NxBlockDefinition {
  type: string;
  label: string;
  description?: string;
  icon?: string;
  defaultProps: Record<string, unknown>;
  propsSchema: NxBlockPropField[];
  render: (props: Record<string, unknown>) => ReactElement;
}

export interface NxBlockPropField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "boolean" | "select" | "url" | "richtext" | "image";
  required?: boolean;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
}

export interface NxBlockInstance {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

// The `blocks` field on a document is stored and edited as a flat
// array of block instances — the editor, the JSONB column, the
// seed scripts, and every theme template all pass an array. The
// historical `{ blocks: [...] }` wrapper was a typing-only mismatch
// that crashed `renderBlocks` whenever a page actually had blocks.
export type NxPageBlocks = NxBlockInstance[];

export interface NxDataBinding {
  collection: string;
  where?: Record<string, unknown>;
  select?: string[];
  sort?: string;
  limit?: number;
}

export interface NxBlockRegistration {
  definition: NxBlockDefinition;
}

export interface NxBlockRegistry {
  register(definition: NxBlockDefinition): void;
  get(type: string): NxBlockDefinition | undefined;
  getAll(): NxBlockDefinition[];
  has(type: string): boolean;
}

void (0 as ReactNode | undefined);
