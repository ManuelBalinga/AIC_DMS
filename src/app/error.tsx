"use client";

import { useEffect } from "react";

import { Button, Card } from "@/components/ui";

/**
 * Route-level error boundary.
 *
 * Deliberately says nothing about what failed: an unhandled error here can
 * carry a database message or a storage path, and this page is reachable by
 * anyone with a session. The digest is enough to find the real error in the
 * server logs.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <Card className="w-full max-w-sm p-6 text-center">
        <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          The page could not be loaded. Trying again often works; if it does not,
          send an administrator the reference below.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-neutral-400 dark:text-neutral-500">
            {error.digest}
          </p>
        ) : null}
        <Button onClick={retry} className="mt-5 w-full">
          Try again
        </Button>
      </Card>
    </main>
  );
}
