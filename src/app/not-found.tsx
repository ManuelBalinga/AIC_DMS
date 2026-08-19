import Link from "next/link";

import { Button, Card } from "@/components/ui";

export const metadata = { title: "Not found | AIC Documents" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <Card className="w-full max-w-sm p-6 text-center">
        <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          Not found
        </h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          This page does not exist — or it is a document that has not been shared
          with you. Ask its owner for access.
        </p>
        <Link href="/dashboard" className="mt-5 block">
          <Button variant="secondary" className="w-full">
            Back to documents
          </Button>
        </Link>
      </Card>
    </main>
  );
}
