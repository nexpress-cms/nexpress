"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";

import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-populates the picker. ISO string or undefined for default (now + 1h). */
  initialPublishedAt?: string;
  /** Pending state — disables the confirm button + shows a spinner. */
  busy?: boolean;
  onSchedule: (publishedAtIso: string) => void;
  /** Optional — shown when an existing scheduled time can be cleared. */
  onCancelSchedule?: () => void;
}

/**
 * Local-time `<input type="datetime-local">` works in `YYYY-MM-DDTHH:mm`
 * with no timezone suffix. The browser interprets the value in the user's
 * local TZ; we convert to a real ISO string at submit time so the server
 * stores UTC.
 */
function nowPlusHourLocal(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  // Strip seconds/timezone, keep YYYY-MM-DDTHH:mm in local time.
  const tzOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

function isoFromLocal(value: string): string | null {
  // `<input type="datetime-local">` returns no timezone suffix; treat it
  // as local time and serialize to a real ISO.
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function localFromIso(iso: string | undefined): string {
  if (!iso) return nowPlusHourLocal();
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return nowPlusHourLocal();
  const tzOffsetMs = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

export function ScheduleDialog({
  open,
  onOpenChange,
  initialPublishedAt,
  busy = false,
  onSchedule,
  onCancelSchedule,
}: ScheduleDialogProps) {
  const [localValue, setLocalValue] = useState(() => localFromIso(initialPublishedAt));
  const [error, setError] = useState<string | null>(null);

  // Reset the picker each time the dialog opens so a stale value from a
  // previous edit doesn't carry over.
  useEffect(() => {
    if (open) {
      setLocalValue(localFromIso(initialPublishedAt));
      setError(null);
    }
  }, [open, initialPublishedAt]);

  const handleSubmit = () => {
    const iso = isoFromLocal(localValue);
    if (!iso) {
      setError("Pick a valid date and time.");
      return;
    }
    if (new Date(iso).getTime() <= Date.now()) {
      setError("Pick a time in the future, or use Publish to go live now.");
      return;
    }
    setError(null);
    onSchedule(iso);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule publish</DialogTitle>
          <DialogDescription>
            Pick a future time. NexPress saves the document with{" "}
            <code>status=scheduled</code> until the cron worker flips it to{" "}
            <code>published</code> at that time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="schedule-publish-at">Publish at</Label>
          <Input
            id="schedule-publish-at"
            type="datetime-local"
            value={localValue}
            onChange={(event) => setLocalValue(event.target.value)}
            min={nowPlusHourLocal().slice(0, 16)}
          />
          {error ? <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {onCancelSchedule ? (
            <Button
              type="button"
              variant="ghost"
              className="text-rose-600 dark:text-rose-300"
              onClick={onCancelSchedule}
              disabled={busy}
            >
              Cancel schedule
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CalendarClock className="mr-2 h-4 w-4" />
              )}
              Schedule
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
