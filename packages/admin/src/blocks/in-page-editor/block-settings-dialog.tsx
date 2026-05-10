"use client";

import { useEffect, useMemo, useState, type Dispatch } from "react";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import { isFieldHidden, type EditorAction } from "../editor-engine/index.js";
import { BlockIcon } from "../shared/block-icon.js";
import { FieldControl } from "../shared/field-control.js";
import { Button } from "../../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { Label } from "../../ui/label.js";

export interface BlockSettingsDialogProps {
  /**
   * Open state of the dialog. Controlled by the parent so the
   * close animation runs through Radix's transition states.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Block being edited. `null` while no block is targeted. */
  block: NpBlockInstance | null;
  /**
   * Definition for the block's type. Provides the form schema
   * (`propsSchema`) the dialog renders. `null` for blocks whose
   * definition isn't in the registry — the dialog renders a
   * read-only "unsupported" notice instead of a form.
   */
  definition: NpBlockMetadata | null;
  /**
   * Engine dispatcher. Save fires `REPLACE_PROPS` so dropped /
   * cleared keys actually leave the wire format (not merged on
   * top of the previous props the way `UPDATE_PROPS` does).
   */
  dispatch: Dispatch<EditorAction>;
}

/**
 * Block-level prop editor surfaced by Doc view's hover-settings
 * affordance. Walks the block's `propsSchema` and renders one
 * `FieldControl` per field — same widget set the form-card editor
 * mounts inline. Edits stay in a draft until the operator clicks
 * Save; Cancel discards the draft and closes the dialog.
 *
 * Why a Dialog (not a side panel): Doc view's whole point is the
 * preview surface — operators want to see the rendered block, not
 * a form crammed alongside it. A modal pulls the form out of the
 * preview flow, edits land cleanly via dispatch, the modal
 * dismisses and the preview re-renders with the new values.
 */
export function BlockSettingsDialog({
  open,
  onOpenChange,
  block,
  definition,
  dispatch,
}: BlockSettingsDialogProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>(
    block?.props ?? {},
  );

  // Reset the draft whenever the targeted block changes — without
  // this the dialog would carry edits from one block over to the
  // next when the operator clicks settings on a different row.
  useEffect(() => {
    if (block) setDraft({ ...block.props });
  }, [block]);

  // Filter out fields whose `hiddenWhen` / `visibleWhen` predicate
  // doesn't match the current draft — same gate the form-card
  // editor's row uses, so the dialog hides irrelevant fields as
  // the operator toggles dependent props.
  const fields = useMemo(() => {
    if (!definition) return [];
    return definition.propsSchema.filter(
      (field) => !isFieldHidden(field, draft),
    );
  }, [definition, draft]);

  const handleSave = () => {
    if (!block) return;
    // REPLACE_PROPS instead of UPDATE_PROPS — the form may have
    // cleared a previously-set field (e.g. unset a media id), and
    // a merge would leave the stale value behind. The dialog's
    // draft is the new full props object.
    dispatch({ type: "REPLACE_PROPS", id: block.id, props: draft });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BlockIcon
              icon={definition?.icon}
              kind={definition?.iconKind}
              className="text-muted-foreground"
            />
            <span>{definition?.label ?? block?.type ?? "Block settings"}</span>
            {block ? (
              <code className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {block.type}
              </code>
            ) : null}
          </DialogTitle>
          {definition?.description ? (
            <DialogDescription>{definition.description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {!definition ? (
            <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
              No definition registered for{" "}
              <code className="font-mono">{block?.type ?? "(unknown)"}</code>.
              The plugin / theme that contributes this block isn&apos;t loaded
              in the current bootstrap. Save the document and check that the
              plugin is enabled, then reopen this view.
            </div>
          ) : fields.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
              This block has no editable props.
            </div>
          ) : (
            fields.map((field) => {
              const inputId = `np-block-settings-${block?.id ?? "x"}-${field.name}`;
              // `boolean` switches embed their own inline Label
              // alongside the toggle (per FieldControl's switch
              // layout), so a sibling label here would double up.
              // Every other field type carries its label in this
              // wrapper so the dialog reads consistently and so
              // screen readers always have a programmatic
              // association via `htmlFor`. (#524)
              const renderInlineLabel = field.type !== "boolean";
              return (
                <div key={field.name} className="space-y-1.5">
                  {renderInlineLabel ? (
                    <Label
                      htmlFor={inputId}
                      className="flex items-center gap-1 text-xs font-medium text-foreground"
                    >
                      {field.label ?? field.name}
                      {field.required ? (
                        <span aria-hidden="true" className="text-destructive">
                          *
                        </span>
                      ) : null}
                    </Label>
                  ) : null}
                  <FieldControl
                    field={field}
                    value={draft[field.name]}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, [field.name]: value }))
                    }
                    inputId={inputId}
                  />
                  {field.description ? (
                    <p className="text-[11px] text-muted-foreground">
                      {field.description}
                    </p>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!block || !definition}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
