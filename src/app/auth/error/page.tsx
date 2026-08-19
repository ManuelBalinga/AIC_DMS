import Link from "next/link";

import { Button, Card } from "@/components/ui";

export const metadata = { title: "Link problem | AIC Documents" };

export default function AuthErrorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <Card className="w-full max-w-sm p-6 text-center">
        <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          That link is no longer valid
        </h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Invitation and recovery links can only be used once, and they expire.
          Ask an administrator to send a new one.
        </p>
        <Link href="/login" className="mt-5 block">
          <Button variant="secondary" className="w-full">
            Back to sign in
          </Button>
        </Link>
      </Card>
    </main>
  );
}
