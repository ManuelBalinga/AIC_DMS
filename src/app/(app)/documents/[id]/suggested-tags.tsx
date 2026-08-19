"use client";

import { useActionState } from "react";

import { acceptSuggestedTags, dismissSuggestedTags } from "@/modules/intelligence/actions";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button, Card } from "@/components/ui";

/**
 * Tags the model proposed, awaiting a person's decision.
 *
 * Presented as checkboxes rather than applied automatically, and shown only to
 * whoever can manage the document. The model proposes; the owner files.
 *
 * All boxes start unticked. Pre-ticking them would make "Add selected" a
 * one-click accept-everything, which is the outcome the separate
 * `suggested_tags` column exists to avoid.
 */
export function SuggestedTags({
  documentId,
  suggestions,
}: {
  documentId: string;
  suggestions: string[];
}) {
  const [state, action, pending] = useActionState(
    acceptSuggestedTags,
    emptyActionState,
  );

  if (suggestions.length === 0) return null;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Suggested tags
          </h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Proposed from the document&rsquo;s contents when it was indexed. Nothing
            is filed until you choose.
          </p>
        </div>

        <form action={dismissSuggestedTags}>
          <input type="hidden" name="document_id" value={documentId} />
          <Button type="submit" variant="ghost">
            Dismiss
          </Button>
        </form>
      </div>

      {state.error ? (
        <div className="mt-3">
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}
      {state.success ? (
        <div className="mt-3">
          <Alert tone="success">{state.success}</Alert>
        </div>
      ) : null}

      <form action={action} className="mt-4">
        <input type="hidden" name="document_id" value={documentId} />

        <div className="flex flex-wrap gap-2">
          {suggestions.map((tag) => (
            <label
              key={tag}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
            >
              <input
                type="checkbox"
                name="tag"
                value={tag}
                className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-700"
              />
              {tag}
            </label>
          ))}
        </div>

        <div className="mt-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Adding..." : "Add selected"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
