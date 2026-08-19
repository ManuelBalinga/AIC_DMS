"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { updateOwnProfile } from "@/modules/auth/actions";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button, Card, Input, Label } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving..." : "Save name"}
    </Button>
  );
}

export function ProfileForm({ defaultName }: { defaultName: string }) {
  const [state, formAction] = useActionState(updateOwnProfile, emptyActionState);

  return (
    <Card className="p-5">
      <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        Display name
      </h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Shown to colleagues when you share a document with them.
      </p>

      <form action={formAction} className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="full_name">Name</Label>
          <Input
            id="full_name"
            name="full_name"
            defaultValue={defaultName}
            autoComplete="name"
          />
        </div>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.success ? <Alert tone="success">{state.success}</Alert> : null}

        <SubmitButton />
      </form>
    </Card>
  );
}
