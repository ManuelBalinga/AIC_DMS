"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { revokeInvitation } from "@/modules/users/actions";
import { emptyActionState } from "@/lib/action-state";
import type { Invitation } from "@/lib/types/database";
import { Alert, Badge, Button, Card } from "@/components/ui";

function RevokeButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" disabled={pending}>
      {pending ? "Revoking..." : "Revoke"}
    </Button>
  );
}

export function PendingInvitations({ invitations }: { invitations: Invitation[] }) {
  const [state, formAction] = useActionState(revokeInvitation, emptyActionState);

  return (
    <Card>
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Pending invitations ({invitations.length})
        </h2>
      </div>

      {state.error ? (
        <div className="px-5 pt-4">
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}

      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm text-neutral-900 dark:text-neutral-100">
                {invitation.email}
              </p>
              {invitation.role === "administrator" ? (
                <Badge tone="amber">Administrator</Badge>
              ) : null}
            </div>
            <form action={formAction}>
              <input type="hidden" name="invitation_id" value={invitation.id} />
              <RevokeButton />
            </form>
          </li>
        ))}
      </ul>
    </Card>
  );
}
