"use client";

import { useActionState, useState } from "react";

import { createTeam } from "@/modules/chat/actions";
import {
  MAX_TEAM_PURPOSE_LENGTH,
  MAX_TOPIC_LENGTH,
} from "@/modules/chat/limits";
import { emptyActionState } from "@/lib/action-state";
import { Alert, Button, Input, Label, Select, Textarea } from "@/components/ui";

export function CreateTeam() {
  const [state, action, pending] = useActionState(createTeam, emptyActionState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Create team
      </Button>
    );
  }

  return (
    <form
      action={action}
      className="w-full space-y-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="team-name">Team name</Label>
          <Input id="team-name" name="name" maxLength={MAX_TOPIC_LENGTH} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="team-visibility">Visibility</Label>
          <Select id="team-visibility" name="visibility" defaultValue="closed">
            <option value="closed">Closed — members only</option>
            <option value="open">Open — everyone can read and join</option>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="team-purpose">Purpose</Label>
        <Textarea
          id="team-purpose"
          name="purpose"
          rows={2}
          maxLength={MAX_TEAM_PURPOSE_LENGTH}
          placeholder="What belongs in this team?"
        />
      </div>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create team"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
