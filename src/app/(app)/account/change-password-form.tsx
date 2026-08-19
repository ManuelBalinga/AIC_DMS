"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { changePassword } from "@/modules/auth/actions";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button, Card, Input, Label } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Updating..." : "Change password"}
    </Button>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePassword, emptyActionState);

  return (
    <Card className="p-5">
      <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        Change password
      </h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        You will stay signed in on this device.
      </p>

      <form action={formAction} className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="current_password">Current password</Label>
          <Input
            id="current_password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
          />
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            At least 10 characters.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm_password">Confirm new password</Label>
          <Input
            id="confirm_password"
            name="confirm_password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
          />
        </div>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.success ? <Alert tone="success">{state.success}</Alert> : null}

        <SubmitButton />
      </form>
    </Card>
  );
}
