"use client";

import { useTransition } from "react";

import { signOut } from "@/modules/auth/actions";
import { clearOfflineData } from "@/modules/offline/storage";

// Styled here rather than through the shared Button: this is the one control
// that sits on the binding rather than on the page, so the page's button
// palette would put dark ink on dark cloth.
export function SignOutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await clearOfflineData().catch(() => undefined);
          await signOut();
        });
      }}
      className="rounded-[2px] px-2.5 py-1.5 text-sm text-parchment transition-colors hover:bg-cloth-edge hover:text-page disabled:opacity-50"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
