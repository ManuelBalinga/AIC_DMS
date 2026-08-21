"use client";

import { useActionState, useEffect, useRef } from "react";

import { sendMessage } from "@/modules/chat/actions";
import { emptyActionState } from "@/lib/action-state";
import { MAX_MESSAGE_LENGTH } from "@/modules/chat/limits";
import { Alert, Button, Textarea } from "@/components/ui";

export function Composer({ threadId }: { threadId: string }) {
  const [state, action, pending] = useActionState(sendMessage, emptyActionState);
  const formRef = useRef<HTMLFormElement>(null);

  // Clearing on success rather than on submit: a message that failed to send is
  // still in the box to retry, instead of lost with an error above an empty form.
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={action} className="space-y-2">
      <input type="hidden" name="thread_id" value={threadId} />
      <Textarea
        name="body"
        rows={3}
        maxLength={MAX_MESSAGE_LENGTH}
        placeholder="Write a message…"
        aria-label="Message"
        required
      />
      <div className="flex items-center justify-between gap-3">
        {state.error ? <Alert tone="error">{state.error}</Alert> : <span />}
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
