"use client";

import { Button } from "../../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";

/**
 * Confirms a delete that would lose work — block has children OR
 * has props that diverge from the registered defaults. Plain rows
 * skip this dialog entirely (the trash button calls `onDelete`
 * directly).
 */

export interface DeleteBlockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  summary: string | null;
  childCount: number;
  onConfirm: () => void;
}

export function DeleteBlockDialog({
  open,
  onOpenChange,
  label,
  summary,
  childCount,
  onConfirm,
}: DeleteBlockDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this block?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <div>
                <span className="font-semibold text-foreground">{label}</span>
                {summary ? <span className="ml-1 text-muted-foreground">— {summary}</span> : null}
              </div>
              {childCount > 0 ? (
                <div className="text-sm text-muted-foreground">
                  Contains {childCount} nested block
                  {childCount === 1 ? "" : "s"}, which will also be removed.
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  This block has edits that will be lost. Use Undo to restore if you delete by
                  mistake.
                </div>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
