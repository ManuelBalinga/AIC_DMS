import Link from "next/link";

import { requireProfile } from "@/modules/auth/session";
import { signOut } from "@/modules/auth/actions";
import { Button } from "@/components/ui";

const NAV_LINK =
  "rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const isAdmin = profile.role === "administrator";

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <nav className="flex items-center gap-1">
            <Link
              href="/dashboard"
              className="mr-3 text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
            >
              AIC Documents
            </Link>
            <Link href="/dashboard" className={NAV_LINK}>
              Documents
            </Link>
            <Link href="/ask" className={NAV_LINK}>
              Ask
            </Link>
            {isAdmin ? (
              <Link href="/admin/team" className={NAV_LINK}>
                Team
              </Link>
            ) : null}
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/account"
              className="hidden text-sm text-neutral-500 hover:text-neutral-900 sm:inline dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              {profile.full_name || profile.email}
            </Link>
            <form action={signOut}>
              <Button type="submit" variant="ghost">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
