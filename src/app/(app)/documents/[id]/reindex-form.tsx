"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { reindexDocument } from "@/modules/documents/actions";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button } from "@/components/ui";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? "Indexing..." : label}
    </Button>
  );
}

export function ReindexForm({
  documentId,
  hasBeenIndexed,
}: {
  documentId: string;
  hasBeenIndexed: boolean;
}) {
  const [state, formAction] = useActionState(reindexDocument, emptyActionState);

  return (
    <div className="space-y-3">
      <form action={formAction}>
        <input type="hidden" name="document_id" value={documentId} />
        <SubmitButton label={hasBeenIndexed ? "Re-index" : "Index now"} />
      </form>

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </div>
  );
}
