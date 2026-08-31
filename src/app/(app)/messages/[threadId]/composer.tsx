"use client";

import { useActionState, useEffect, useRef } from "react";

import { sendMessage } from "@/modules/chat/actions";
import { emptyActionState } from "@/lib/action-state";
import { MAX_MESSAGE_LENGTH } from "@/modules/chat/limits";
import { Alert, Button, Textarea } from "@/components/ui";
import type { ChatPerson } from "@/modules/chat/presentation";

export function Composer({
  threadId,
  people,
  replyTo,
  onCancelReply,
}: {
  threadId: string;
  people: ChatPerson[];
  replyTo: { id: string; label: string } | null;
  onCancelReply: () => void;
}) {
  const [state, action, pending] = useActionState(sendMessage, emptyActionState);
  const formRef = useRef<HTMLFormElement>(null);

  // Clearing on success rather than on submit: a message that failed to send is
  // still in the box to retry, instead of lost with an error above an empty form.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      onCancelReply();
    }
  }, [state.success, onCancelReply]);

  return (
    <form ref={formRef} action={action} className="space-y-2">
      <input type="hidden" name="thread_id" value={threadId} />
      <input type="hidden" name="parent_id" value={replyTo?.id ?? ""} />
      {replyTo ? (
        <div className="flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
          <span>Replying to {replyTo.label}</span>
          <Button type="button" variant="ghost" onClick={onCancelReply}>
            Cancel
          </Button>
        </div>
      ) : null}
      <Textarea
        name="body"
        rows={3}
        maxLength={MAX_MESSAGE_LENGTH}
        placeholder="Write a message…"
        aria-label="Message"
        required
      />
      {people.length > 0 ? (
        <details className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <summary className="cursor-pointer text-sm text-neutral-600 dark:text-neutral-300">
            Mention people
          </summary>
          <div className="mt-2 flex flex-wrap gap-3">
            {people.map((person) => (
              <label key={person.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="mentioned_user_ids"
                  value={person.id}
                  className="size-4 rounded border-neutral-300"
                />
                @{person.full_name?.trim() || person.email}
              </label>
            ))}
          </div>
        </details>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        {state.error ? <Alert tone="error">{state.error}</Alert> : <span />}
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
