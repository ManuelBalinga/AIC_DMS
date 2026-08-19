"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { updateDocument } from "@/modules/documents/actions";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button, Card, Input, Label, Textarea } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving..." : "Save changes"}
    </Button>
  );
}

export function EditForm({
  documentId,
  title,
  description,
  tags,
}: {
  documentId: string;
  title: string;
  description: string;
  tags: string[];
}) {
  const [state, formAction] = useActionState(updateDocument, emptyActionState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Title, description and tags
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {tags.length > 0 ? `Tagged ${tags.join(", ")}.` : "No tags yet."}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Edit
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        Edit document
      </h2>

      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="document_id" value={documentId} />

        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" defaultValue={title} required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            rows={2}
            defaultValue={description}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tags">Tags</Label>
          <Input
            id="tags"
            name="tags"
            defaultValue={tags.join(", ")}
            placeholder="product docs, i363, updates"
          />
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Comma separated.
          </p>
        </div>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.success ? <Alert tone="success">{state.success}</Alert> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
          <SubmitButton />
        </div>
      </form>
    </Card>
  );
}
