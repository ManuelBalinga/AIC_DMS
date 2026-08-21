"use client";

import { useActionState, useState } from "react";

import { leaveThread, renameThread } from "@/modules/chat/actions";
import { emptyActionState } from "@/lib/action-state";
import { MAX_TOPIC_LENGTH } from "@/modules/chat/limits";
import { Alert, Button, Input } from "@/components/ui";

export function ThreadSettings({
  threadId,
  topic,
}: {
  threadId: string;
  topic: string | null;
}) {
  const [renameState, renameAction, renaming] = useActionState(
    renameThread,
    emptyActionState,
  );
  const [leaveState, leaveAction, leaving] = useActionState(
    leaveThread,
    emptyActionState,
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        Settings
      </Button>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <form action={renameAction} className="flex items-end gap-2">
        <input type="hidden" name="thread_id" value={threadId} />
        <div className="flex-1">
          <Input
            name="topic"
            defaultValue={topic ?? ""}
            maxLength={MAX_TOPIC_LENGTH}
            placeholder="Name this conversation"
            aria-label="Conversation name"
          />
        </div>
        <Button type="submit" disabled={renaming}>
          {renaming ? "Saving…" : "Save"}
        </Button>
      </form>
      {renameState.error ? <Alert tone="error">{renameState.error}</Alert> : null}

      <form action={leaveAction}>
        <input type="hidden" name="thread_id" value={threadId} />
        <Button type="submit" variant="ghost" disabled={leaving}>
          {leaving ? "Leaving…" : "Leave conversation"}
        </Button>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Leaving removes only you. The others keep the thread and everything in it.
        </p>
      </form>
      {leaveState.error ? <Alert tone="error">{leaveState.error}</Alert> : null}

      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Close
      </Button>
    </div>
  );
}
