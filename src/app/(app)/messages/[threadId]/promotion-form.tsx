"use client";

import { useActionState } from "react";

import { Alert, Button, Input, Label } from "@/components/ui";
import { emptyActionState } from "@/lib/action-state";
import { promoteThreadToDocument } from "@/modules/chat/actions";
import { MAX_PROMOTION_TITLE_LENGTH } from "@/modules/chat/promotion";

export function PromotionForm({
  threadId,
  defaultTitle,
  isTeam,
}: {
  threadId: string;
  defaultTitle: string;
  isTeam: boolean;
}) {
  const [state, action, pending] = useActionState(
    promoteThreadToDocument,
    emptyActionState,
  );

  return (
    <details className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <summary className="cursor-pointer text-sm font-medium text-neutral-900 dark:text-neutral-100">
        Promote this conversation to a document
      </summary>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        Creates a Markdown snapshot owned by you, ready for the normal document index.
        {isTeam
          ? " Every current and future member of this Team receives Viewer access."
          : " A direct conversation stays private to you until you explicitly share the document."}
      </p>
      <form action={action} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <input type="hidden" name="thread_id" value={threadId} />
        <div>
          <Label htmlFor="promotion-title">Document title</Label>
          <Input
            id="promotion-title"
            name="title"
            defaultValue={defaultTitle}
            maxLength={MAX_PROMOTION_TITLE_LENGTH}
            required
          />
        </div>
        <div>
          <Label htmlFor="promotion-tags">Tags</Label>
          <Input
            id="promotion-tags"
            name="tags"
            defaultValue={isTeam ? "team, discussion" : "discussion"}
            placeholder="discussion, decision"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Promoting…" : "Create document"}
        </Button>
      </form>
      {state.error ? <div className="mt-3"><Alert tone="error">{state.error}</Alert></div> : null}
    </details>
  );
}
