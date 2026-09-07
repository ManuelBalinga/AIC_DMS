"use client";

import { useTransition } from "react";

import { signOut } from "@/modules/auth/actions";
import { clearOfflineData } from "@/modules/offline/storage";

// Styled here rather than through the shared Button because it owns a pending
// label the shared control has no notion of. It is otherwise the ghost variant,
// and it follows the header's ink now that the header is a light surface — the
// hover used to force the inverse ink, which on a light header is white on grey.
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
      className="rounded-control px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-surface-sunk hover:text-ink disabled:opacity-50"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
