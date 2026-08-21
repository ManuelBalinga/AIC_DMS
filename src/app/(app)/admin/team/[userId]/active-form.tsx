"use client";

import { useActionState } from "react";

import { setMemberActive } from "@/modules/users/actions";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button } from "@/components/ui";

export function ActiveForm({
  userId,
  deactivated,
}: {
  userId: string;
  deactivated: boolean;
}) {
  const [state, action, pending] = useActionState(setMemberActive, emptyActionState);

  return (
    <div>
      <form action={action}>
        <input type="hidden" name="user_id" value={userId} />
        <input type="hidden" name="active" value={deactivated ? "true" : "false"} />
        <Button type="submit" variant={deactivated ? "secondary" : "ghost"} disabled={pending}>
          {pending
            ? "Working..."
            : deactivated
              ? "Restore access"
              : "End access"}
        </Button>
      </form>
      {state.error ? (
        <div className="mt-2">
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}
      {state.success ? (
        <div className="mt-2">
          <Alert tone="success">{state.success}</Alert>
        </div>
      ) : null}
    </div>
  );
}
