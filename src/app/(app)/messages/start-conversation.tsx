"use client";

import { useActionState, useState } from "react";

import { startDirectThread } from "@/modules/chat/actions";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button, Select } from "@/components/ui";
import type { ChatPerson } from "@/modules/chat/queries";

/**
 * Starting a direct conversation.
 *
 * The action calls `find_or_create_direct_thread` rather than inserting, so
 * picking somebody you already have a thread with reopens it instead of
 * creating a second one.
 */
export function StartConversation({ people }: { people: ChatPerson[] }) {
  const [state, action, pending] = useActionState(startDirectThread, emptyActionState);
  const [open, setOpen] = useState(false);

  if (people.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Nobody else has joined yet.
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        New conversation
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Select name="user_id" aria-label="Who to message" defaultValue="">
        <option value="" disabled>
          Choose a colleague…
        </option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.full_name?.trim() || person.email}
          </option>
        ))}
      </Select>
      <Button type="submit" disabled={pending}>
        {pending ? "Starting…" : "Start"}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
    </form>
  );
}
