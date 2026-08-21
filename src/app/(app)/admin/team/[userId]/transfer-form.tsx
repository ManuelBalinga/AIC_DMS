"use client";

import { useActionState } from "react";

import { transferDocumentOwnership } from "@/modules/users/actions";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button, Select } from "@/components/ui";

export function TransferForm({
  documentId,
  candidates,
}: {
  documentId: string;
  candidates: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(
    transferDocumentOwnership,
    emptyActionState,
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="document_id" value={documentId} />
        <Select
          name="new_owner_id"
          required
          defaultValue=""
          aria-label="New owner"
          className="w-44 text-xs"
        >
          <option value="">Transfer to…</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "…" : "Transfer"}
        </Button>
      </form>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </div>
  );
}
