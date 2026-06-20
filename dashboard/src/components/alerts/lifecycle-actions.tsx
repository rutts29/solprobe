"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { patchAlertState, postAlertNote } from "@/lib/api";
import { formatTimestamp } from "@/lib/utils";
import type { AlertLifecycle, AlertLifecycleState } from "@/lib/types";

interface LifecycleActionsProps {
  alertId: string;
  lifecycle: AlertLifecycle | null;
  onChange: (next: AlertLifecycle) => void;
}

const STATE_ACTIONS: { state: AlertLifecycleState; label: string }[] = [
  { state: "acknowledged", label: "Acknowledge" },
  { state: "investigating", label: "Mark investigating" },
  { state: "resolved", label: "Resolve" },
  { state: "ignored", label: "Ignore for run" },
];

const STATE_VARIANT: Record<AlertLifecycleState, "info" | "warning" | "success" | "secondary"> = {
  acknowledged: "info",
  investigating: "warning",
  resolved: "success",
  ignored: "secondary",
};

export function LifecycleActions({ alertId, lifecycle, onChange }: LifecycleActionsProps) {
  const [pending, setPending] = useState<AlertLifecycleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  const currentState = lifecycle?.state ?? null;
  const notes = lifecycle?.notes ?? [];

  async function handleSetState(next: AlertLifecycleState) {
    setPending(next);
    setError(null);
    try {
      const result = await patchAlertState(alertId, next);
      onChange(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update state");
    } finally {
      setPending(null);
    }
  }

  async function handleAddNote() {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    setNoteSubmitting(true);
    setError(null);
    try {
      const result = await postAlertNote(alertId, trimmed);
      onChange(result);
      setNoteText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add note");
    } finally {
      setNoteSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifecycle</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">State</span>
          {currentState ? (
            <Badge variant={STATE_VARIANT[currentState]}>{currentState}</Badge>
          ) : (
            <Badge variant="outline">open</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {STATE_ACTIONS.map(({ state, label }) => (
            <Button
              key={state}
              size="sm"
              variant={currentState === state ? "default" : "outline"}
              disabled={pending !== null}
              onClick={() => handleSetState(state)}
            >
              {pending === state ? "Saving..." : label}
            </Button>
          ))}
        </div>

        {error && (
          <ErrorBanner title="Lifecycle update failed" message={error} />
        )}

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Notes
          </div>
          {notes.length === 0 ? (
            <p className="text-xs text-muted-foreground">No notes yet</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n, i) => (
                <li key={`${n.timestamp_ms}-${i}`} className="rounded-md border p-2 text-xs">
                  <p>{n.text}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {n.author ?? "anonymous"} · {formatTimestamp(n.timestamp_ms)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note..."
              className="flex-1 rounded-md border bg-background px-2 py-1 text-xs"
              disabled={noteSubmitting}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAddNote();
                }
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={noteSubmitting || noteText.trim() === ""}
              onClick={handleAddNote}
            >
              {noteSubmitting ? "..." : "Add"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
