"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { inviteTeamMember } from "@/modules/users/actions";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button, Card, Input, Label, Select } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Sending..." : "Send invitation"}
    </Button>
  );
}

export function InviteForm() {
  const [state, formAction] = useActionState(inviteTeamMember, emptyActionState);

  return (
    <Card className="p-5">
      <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        Invite a person
      </h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        They receive an email link and choose their own password.
      </p>

      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            placeholder="colleague@aic.example"
          />
        </div>

        <div className="w-40 space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <Select id="role" name="role" defaultValue="member">
            <option value="member">Member</option>
            <option value="administrator">Administrator</option>
          </Select>
        </div>

        <SubmitButton />
      </form>

      {state.error ? (
        <div className="mt-3">
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}
      {state.success ? (
        <div className="mt-3">
          <Alert tone="success">{state.success}</Alert>
        </div>
      ) : null}
    </Card>
  );
}
