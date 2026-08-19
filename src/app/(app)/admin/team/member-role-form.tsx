"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { changeMemberRole } from "@/modules/users/actions";
import { emptyActionState } from "@/lib/action-state";
import type { UserRole } from "@/lib/types/database";
import { Button, Select } from "@/components/ui";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? "Saving..." : "Save"}
    </Button>
  );
}

export function MemberRoleForm({
  userId,
  currentRole,
}: {
  userId: string;
  currentRole: UserRole;
}) {
  const [state, formAction] = useActionState(changeMemberRole, emptyActionState);

  return (
    <div className="flex items-center gap-2">
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="user_id" value={userId} />
        <Select name="role" defaultValue={currentRole} className="w-40">
          <option value="member">Team member</option>
          <option value="administrator">Administrator</option>
        </Select>
        <SaveButton />
      </form>
      {state.error ? (
        <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>
      ) : null}
    </div>
  );
}
