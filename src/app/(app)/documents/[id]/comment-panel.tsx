"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  deleteComment,
  postComment,
  toggleCommentResolved,
} from "@/modules/comments/actions";
import { emptyActionState } from "@/lib/action-state";
import type { CommentThread } from "@/modules/comments/queries";
import { Alert, Badge, Button, Card, Textarea } from "@/components/ui";

function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function authorName(author: CommentThread["author"]): string {
  // A null author is somebody whose account was deleted. Their comments stay,
  // because a review thread with half its turns removed reads as though the
  // remaining people were answering nobody.
  if (!author) return "Former colleague";
  return author.full_name || author.email;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CommentPanel({
  documentId,
  threads,
  canComment,
  canResolveAny,
  currentUserId,
}: {
  documentId: string;
  threads: CommentThread[];
  canComment: boolean;
  /** Whoever can manage the document may settle any thread, not only their own. */
  canResolveAny: boolean;
  currentUserId: string;
}) {
  const [state, action] = useActionState(postComment, emptyActionState);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const open = threads.filter((thread) => thread.resolved_at === null);
  const resolved = threads.filter((thread) => thread.resolved_at !== null);
  const visible = showResolved ? threads : open;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Comments
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {open.length === 0
              ? "Nothing open."
              : `${open.length} open thread${open.length === 1 ? "" : "s"}.`}{" "}
            Visible to everyone who can read this document.
          </p>
        </div>

        {resolved.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowResolved((current) => !current)}
            className="text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            {showResolved
              ? "Hide resolved"
              : `Show ${resolved.length} resolved`}
          </button>
        ) : null}
      </div>

      {state.error ? (
        <div className="mt-3">
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}

      {canComment ? (
        <form action={action} className="mt-4 space-y-2">
          <input type="hidden" name="document_id" value={documentId} />
          <Textarea
            name="body"
            rows={3}
            required
            placeholder="Add a comment about this document…"
          />
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              Page
              <input
                type="number"
                name="page_number"
                min={1}
                placeholder="any"
                className="w-16 rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-xs dark:border-neutral-800"
              />
              <span className="text-neutral-400 dark:text-neutral-500">
                optional — leave blank for the document as a whole
              </span>
            </label>
            <SubmitButton label="Comment" busy="Posting..." />
          </div>
        </form>
      ) : (
        <p className="mt-4 rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          You can read this document but not comment on it. Ask the owner for
          Commenter access.
        </p>
      )}

      {visible.length === 0 ? null : (
        <ul className="mt-5 space-y-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          {visible.map((thread) => {
            const settled = thread.resolved_at !== null;
            const mine = thread.author_id === currentUserId;

            return (
              <li
                key={thread.id}
                className={settled ? "opacity-60" : undefined}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {authorName(thread.author)}
                  </span>
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">
                    {when(thread.created_at)}
                  </span>
                  {thread.page_number ? (
                    <Badge tone="neutral">page {thread.page_number}</Badge>
                  ) : null}
                  {settled ? <Badge tone="blue">Resolved</Badge> : null}
                </div>

                {thread.quoted_text ? (
                  <p className="mt-1.5 border-l-2 border-neutral-300 pl-2 text-xs italic text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                    {thread.quoted_text}
                  </p>
                ) : null}

                <p className="mt-1.5 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">
                  {thread.body}
                </p>

                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                  {canComment && !settled ? (
                    <button
                      type="button"
                      onClick={() =>
                        setReplyingTo(replyingTo === thread.id ? null : thread.id)
                      }
                      className="font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                    >
                      {replyingTo === thread.id ? "Cancel" : "Reply"}
                    </button>
                  ) : null}

                  {mine || canResolveAny ? (
                    <form action={toggleCommentResolved}>
                      <input type="hidden" name="comment_id" value={thread.id} />
                      <input type="hidden" name="document_id" value={documentId} />
                      <input
                        type="hidden"
                        name="resolve"
                        value={settled ? "false" : "true"}
                      />
                      <button
                        type="submit"
                        className="font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                      >
                        {settled ? "Reopen" : "Resolve"}
                      </button>
                    </form>
                  ) : null}

                  {mine ? (
                    <form action={deleteComment}>
                      <input type="hidden" name="comment_id" value={thread.id} />
                      <input type="hidden" name="document_id" value={documentId} />
                      <button
                        type="submit"
                        className="font-medium text-neutral-400 hover:text-red-600 dark:text-neutral-500"
                      >
                        Delete
                      </button>
                    </form>
                  ) : null}
                </div>

                {thread.replies.length > 0 ? (
                  <ul className="mt-3 space-y-3 border-l-2 border-neutral-200 pl-3 dark:border-neutral-800">
                    {thread.replies.map((reply) => (
                      <li key={reply.id}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                            {authorName(reply.author)}
                          </span>
                          <span className="text-xs text-neutral-400 dark:text-neutral-500">
                            {when(reply.created_at)}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">
                          {reply.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {replyingTo === thread.id ? (
                  <form action={action} className="mt-3 space-y-2 pl-3">
                    <input type="hidden" name="document_id" value={documentId} />
                    <input type="hidden" name="parent_id" value={thread.id} />
                    <Textarea name="body" rows={2} required placeholder="Reply…" />
                    <SubmitButton label="Reply" busy="Posting..." />
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
