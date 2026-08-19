"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { grantDocumentAccess, revokeDocumentAccess } from "@/modules/access/actions";
import { emptyActionState } from "@/lib/action-state";
import type { DocumentGrant } from "@/modules/access/queries";
import type { Profile } from "@/lib/types/database";
import { Alert, Button, Card, Label, Select } from "@/components/ui";

function GrantButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Sharing..." : "Share"}
    </Button>
  );
}

function RevokeButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" disabled={pending}>
      {pending ? "Removing..." : "Remove"}
    </Button>
  );
}

export function SharePanel({
  documentId,
  grants,
  shareableMembers,
}: {
  documentId: string;
  grants: DocumentGrant[];
  shareableMembers: Profile[];
}) {
  const [grantState, grantAction] = useActionState(
    grantDocumentAccess,
    emptyActionState,
  );
  const [revokeState, revokeAction] = useActionState(
    revokeDocumentAccess,
    emptyActionState,
  );

  return (
    <Card className="p-5">
      <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        Who can see this
      </h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Only the people listed here, plus administrators.
      </p>

      <form action={grantAction} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="document_id" value={documentId} />
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="user_id">Add a team member</Label>
          <Select id="user_id" name="user_id" required disabled={shareableMembers.length === 0}>
            {shareableMembers.length === 0 ? (
              <option value="">Everyone already has access</option>
            ) : (
              <>
                <option value="">Choose someone...</option>
                {shareableMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name ? `${member.full_name} (${member.email})` : member.email}
                  </option>
                ))}
              </>
            )}
          </Select>
        </div>
        <GrantButton />
      </form>

      {grantState.error ? (
        <div className="mt-3">
          <Alert tone="error">{grantState.error}</Alert>
        </div>
      ) : null}
      {grantState.success ? (
        <div className="mt-3">
          <Alert tone="success">{grantState.success}</Alert>
        </div>
      ) : null}
      {revokeState.error ? (
        <div className="mt-3">
          <Alert tone="error">{revokeState.error}</Alert>
        </div>
      ) : null}

      {grants.length > 0 ? (
        <ul className="mt-5 divide-y divide-neutral-200 border-t border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {grants.map((grant) => (
            <li
              key={grant.user_id}
              className="flex items-center justify-between gap-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-neutral-900 dark:text-neutral-100">
                  {grant.profile?.full_name || grant.profile?.email || "Unknown user"}
                </p>
                {grant.profile?.full_name ? (
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {grant.profile.email}
                  </p>
                ) : null}
              </div>
              <form action={revokeAction}>
                <input type="hidden" name="document_id" value={documentId} />
                <input type="hidden" name="user_id" value={grant.user_id} />
                <RevokeButton />
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 border-t border-neutral-200 pt-4 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          Not shared with anyone yet.
        </p>
      )}
    </Card>
  );
}
