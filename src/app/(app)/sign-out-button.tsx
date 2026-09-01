"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui";
import { signOut } from "@/modules/auth/actions";
import { clearOfflineData } from "@/modules/offline/storage";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await clearOfflineData().catch(() => undefined);
          await signOut();
        });
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
