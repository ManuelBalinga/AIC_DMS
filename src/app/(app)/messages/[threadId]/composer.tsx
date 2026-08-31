"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import Link from "next/link";

import { sendMessage, type SendMessageState } from "@/modules/chat/actions";
import { MAX_MESSAGE_LENGTH } from "@/modules/chat/limits";
import { Alert, Button, Textarea } from "@/components/ui";
import type { ChatPerson } from "@/modules/chat/presentation";
import type { ReferenceableDocument } from "@/lib/types/database";

const emptySendMessageState: SendMessageState = {};

export function Composer({
  threadId,
  people,
  replyTo,
  onCancelReply,
  documents,
  teamVisibility,
}: {
  threadId: string;
  people: ChatPerson[];
  replyTo: { id: string; label: string } | null;
  onCancelReply: () => void;
  documents: ReferenceableDocument[];
  teamVisibility: "open" | "closed" | null;
}) {
  const [state, action, pending] = useActionState(sendMessage, emptySendMessageState);
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");

  // Clearing on success rather than on submit: a message that failed to send is
  // still in the box to retry, instead of lost with an error above an empty form.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      onCancelReply();
      const resetSelection = window.setTimeout(() => setSelectedDocumentId(""), 0);
      return () => window.clearTimeout(resetSelection);
    }
  }, [state.success, onCancelReply]);

  return (
    <form ref={formRef} action={action} className="space-y-2">
      <input type="hidden" name="thread_id" value={threadId} />
      <input type="hidden" name="parent_id" value={replyTo?.id ?? ""} />
      {replyTo ? (
        <div className="flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
          <span>Replying to {replyTo.label}</span>
          <Button type="button" variant="ghost" onClick={onCancelReply}>
            Cancel
          </Button>
        </div>
      ) : null}
      <Textarea
        name="body"
        rows={3}
        maxLength={MAX_MESSAGE_LENGTH}
        placeholder="Write a message…"
        aria-label="Message"
        required
      />
      {people.length > 0 ? (
        <details className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <summary className="cursor-pointer text-sm text-neutral-600 dark:text-neutral-300">
            Mention people
          </summary>
          <div className="mt-2 flex flex-wrap gap-3">
            {people.map((person) => (
              <label key={person.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="mentioned_user_ids"
                  value={person.id}
                  className="size-4 rounded border-neutral-300"
                />
                @{person.full_name?.trim() || person.email}
              </label>
            ))}
          </div>
        </details>
      ) : null}
      {documents.length > 0 ? (
        <label className="block text-sm text-neutral-600 dark:text-neutral-300">
          Reference a document (optional)
          <select
            name="referenced_document_id"
            value={selectedDocumentId}
            onChange={(event) => setSelectedDocumentId(event.target.value)}
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          >
            <option value="">No document</option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>{document.title}</option>
            ))}
          </select>
        </label>
      ) : null}
      {state.referenceWarning && state.referenceWarning.documentId === selectedDocumentId ? (
        <Alert tone="warning">
          <span className="block">
            {state.referenceWarning.inaccessibleCount} {state.referenceWarning.inaccessibleCount === 1 ? "person" : "people"} who can read this conversation cannot open that document.
          </span>
          <span className="mt-1 block">Grant access first, post a locked card, or cancel the reference.</span>
          {teamVisibility === "open" ? (
            <span className="mt-1 block">Granting the Team covers members; other staff who can read this open Team may still see a locked card.</span>
          ) : null}
          <span className="mt-2 flex flex-wrap gap-3">
            <Link href={`/documents/${selectedDocumentId}`} className="font-medium underline">Review access</Link>
            <button type="button" className="font-medium underline" onClick={() => setSelectedDocumentId("")}>Cancel reference</button>
          </span>
        </Alert>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        {state.error ? <Alert tone="error">{state.error}</Alert> : <span />}
        <span className="flex flex-wrap gap-2">
          {state.referenceWarning?.documentId === selectedDocumentId && state.referenceWarning.canGrantTeam ? (
            <Button type="submit" name="reference_mode" value="grant_team" disabled={pending}>
              {pending ? "Sending…" : "Grant Team Viewer & send"}
            </Button>
          ) : null}
          <Button
            type="submit"
            name={state.referenceWarning?.documentId === selectedDocumentId ? "confirm_locked_reference" : undefined}
            value={state.referenceWarning?.documentId === selectedDocumentId ? "true" : undefined}
            disabled={pending}
          >
            {pending ? "Sending…" : state.referenceWarning?.documentId === selectedDocumentId ? "Post locked card" : "Send"}
          </Button>
        </span>
      </div>
    </form>
  );
}
