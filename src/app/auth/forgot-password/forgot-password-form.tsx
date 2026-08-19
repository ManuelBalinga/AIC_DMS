"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { requestPasswordReset } from "@/modules/auth/actions";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button, Card, Input, Label } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Sending..." : "Send recovery link"}
    </Button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordReset, emptyActionState);

  return (
    <Card className="p-6">
      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@aic.example"
          />
        </div>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.success ? <Alert tone="success">{state.success}</Alert> : null}

        <SubmitButton />
      </form>
    </Card>
  );
}
