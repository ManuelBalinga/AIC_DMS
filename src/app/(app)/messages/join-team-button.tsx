"use client";

import { useActionState } from "react";

import { joinTeam } from "@/modules/chat/actions";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button } from "@/components/ui";

export function JoinTeamButton({ threadId }: { threadId: string }) {
  const [state, action, pending] = useActionState(joinTeam, emptyActionState);

  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="thread_id" value={threadId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Joining…" : "Join team"}
      </Button>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
    </form>
  );
}
