"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { setPassword } from "@/modules/auth/actions";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button, Card, Input, Label } from "@/components/ui";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Saving..." : label}
    </Button>
  );
}

export function SetPasswordForm({
  defaultName,
  isRecovery = false,
}: {
  defaultName: string;
  isRecovery?: boolean;
}) {
  const [state, formAction] = useActionState(setPassword, emptyActionState);

  return (
    <Card className="p-6">
      <form action={formAction} className="space-y-4">
        {isRecovery ? null : (
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Your name</Label>
            <Input
              id="full_name"
              name="full_name"
              defaultValue={defaultName}
              autoComplete="name"
              placeholder="Ada Mensah"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="password">
            {isRecovery ? "New password" : "Choose a password"}
          </Label>
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
          <Label htmlFor="confirm_password">Confirm password</Label>
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

        <SubmitButton label={isRecovery ? "Save and continue" : "Enter the platform"} />
      </form>
    </Card>
  );
}
