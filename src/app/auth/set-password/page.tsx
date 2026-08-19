import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/modules/auth/session";
import { SetPasswordForm } from "./set-password-form";

export const metadata = { title: "Choose a password | AIC Documents" };

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const [{ mode }, profile] = await Promise.all([
    searchParams,
    getCurrentProfile(),
  ]);

  // Reachable only with the session minted by the invitation or recovery link.
  if (!profile) redirect("/auth/error");

  const isRecovery = mode === "recovery";

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            {isRecovery ? "Choose a new password" : "Welcome to AIC Documents"}
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {isRecovery
              ? `Signed in as ${profile.email}`
              : `Finish setting up ${profile.email}`}
          </p>
        </div>

        <SetPasswordForm
          defaultName={profile.full_name ?? ""}
          isRecovery={isRecovery}
        />
      </div>
    </main>
  );
}
