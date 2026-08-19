import { Card } from "@/components/ui";

/**
 * Skeleton for the authenticated shell.
 *
 * Every page in this group queries the database before rendering, so without a
 * loading state a navigation looks like nothing happened for a moment.
 */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-6 w-40 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-4 w-56 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
      </div>

      <Card>
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {[0, 1, 2, 3].map((row) => (
            <li key={row} className="space-y-2 px-4 py-4">
              <div className="h-4 w-1/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
