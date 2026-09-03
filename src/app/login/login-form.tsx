"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { signIn } from "@/modules/auth/actions";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button, Card, Input, Label } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Signing in..." : "Sign in"}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(signIn, emptyActionState);

  return (
    <Card className="p-6">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next ?? "/dashboard"} />

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

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 leading-4">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/auth/forgot-password"
              // Matched to the Label's size on purpose: a larger link in this
              // row makes the row taller than a bare label, which pushed the
              // password rule 16px further from its label than the email one.
              className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft underline underline-offset-2 transition-colors hover:text-rule"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}

        <SubmitButton />
      </form>
    </Card>
  );
}
