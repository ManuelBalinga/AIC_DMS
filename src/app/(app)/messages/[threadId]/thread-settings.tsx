"use client";

import { useActionState, useState } from "react";

import {
  addTeamMember,
  leaveThread,
  removeTeamMember,
  updateTeamDetails,
} from "@/modules/chat/actions";
import { emptyActionState } from "@/lib/action-state";
import type { ChatPerson } from "@/modules/chat/presentation";
import {
  MAX_TEAM_PURPOSE_LENGTH,
  MAX_TOPIC_LENGTH,
} from "@/modules/chat/limits";
import type { ChatTeamVisibility } from "@/lib/types/database";
import { Alert, Button, Input, Label, Select, Textarea } from "@/components/ui";

function LeaveConversation({ threadId, label = "Leave conversation" }: { threadId: string; label?: string }) {
  const [state, action, pending] = useActionState(leaveThread, emptyActionState);
  return (
    <div className="space-y-1">
      <form action={action}>
        <input type="hidden" name="thread_id" value={threadId} />
        <Button type="submit" variant="ghost" disabled={pending}>{pending ? "Leaving…" : label}</Button>
      </form>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
    </div>
  );
}

export function DirectSettings() {
  const [open, setOpen] = useState(false);
  if (!open) return <Button type="button" variant="ghost" onClick={() => setOpen(true)}>Settings</Button>;
  return (
    <div className="w-full max-w-sm space-y-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Direct conversation</p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">Direct messages stay two-person conversations. Create a Team when more people need a shared space.</p>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
    </div>
  );
}

export function TeamSettings({
  threadId,
  name,
  purpose,
  visibility,
  participants,
  people,
  currentUserId,
  viewerIsParticipant,
  canEditDetails,
  teamDocumentCount,
}: {
  threadId: string;
  name: string;
  purpose: string | null;
  visibility: ChatTeamVisibility;
  participants: ChatPerson[];
  people: ChatPerson[];
  currentUserId: string;
  viewerIsParticipant: boolean;
  canEditDetails: boolean;
  teamDocumentCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [detailsState, detailsAction, saving] = useActionState(updateTeamDetails, emptyActionState);
  const [addState, addAction, adding] = useActionState(addTeamMember, emptyActionState);
  const [removeState, removeAction, removing] = useActionState(removeTeamMember, emptyActionState);
  const participantIds = new Set(participants.map((person) => person.id));
  const candidates = people.filter((person) => !participantIds.has(person.id));
  const [selectedUserId, setSelectedUserId] = useState("");
  const selectedPerson = candidates.find((person) => person.id === selectedUserId);

  if (!open) return <Button type="button" variant="ghost" onClick={() => setOpen(true)}>Team settings</Button>;

  return (
    <div className="w-full max-w-xl space-y-5 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      {canEditDetails ? <form action={detailsAction} className="space-y-3">
        <input type="hidden" name="thread_id" value={threadId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="team-settings-name">Team name</Label>
            <Input id="team-settings-name" name="name" defaultValue={name} maxLength={MAX_TOPIC_LENGTH} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-settings-visibility">Visibility</Label>
            <Select id="team-settings-visibility" name="visibility" defaultValue={visibility}>
              <option value="closed">Closed — members only</option>
              <option value="open">Open — everyone can read and join</option>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="team-settings-purpose">Purpose</Label>
          <Textarea id="team-settings-purpose" name="purpose" defaultValue={purpose ?? ""} rows={2} maxLength={MAX_TEAM_PURPOSE_LENGTH} />
        </div>
        <p className="text-xs text-amber-700 dark:text-amber-300">Making a closed team open makes its existing conversation readable by everyone at AIC.</p>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save team settings"}</Button>
        {detailsState.error ? <Alert tone="error">{detailsState.error}</Alert> : null}
        {detailsState.success ? <Alert tone="success">{detailsState.success}</Alert> : null}
      </form> : null}

      <div className="space-y-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <div>
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Members</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Membership controls who can write, and who can read when the team is closed.</p>
        </div>
        {candidates.length > 0 ? (
          <form
            action={addAction}
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              if (teamDocumentCount === 0) return;
              const person = selectedPerson?.full_name?.trim() || selectedPerson?.email || "this person";
              const noun = teamDocumentCount === 1 ? "document" : "documents";
              if (!window.confirm(`${name} has access to ${teamDocumentCount} ${noun}. Adding ${person} gives them access too. Continue?`)) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="thread_id" value={threadId} />
            <div className="min-w-56 flex-1 space-y-1.5">
              <Label htmlFor="team-member">Add person</Label>
              <Select
                id="team-member"
                name="user_id"
                defaultValue=""
                required
                onChange={(event) => setSelectedUserId(event.target.value)}
              >
                <option value="" disabled>Choose a colleague…</option>
                {candidates.map((person) => <option key={person.id} value={person.id}>{person.full_name?.trim() || person.email}</option>)}
              </Select>
            </div>
            <Button type="submit" disabled={adding}>{adding ? "Adding…" : "Add member"}</Button>
          </form>
        ) : null}
        {teamDocumentCount > 0 ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            This Team has access to {teamDocumentCount} {teamDocumentCount === 1 ? "document" : "documents"}. A new member inherits all of them.
          </p>
        ) : null}
        {addState.error ? <Alert tone="error">{addState.error}</Alert> : null}
        {addState.success ? <Alert tone="success">{addState.success}</Alert> : null}
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {participants.map((person) => (
            <li key={person.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm text-neutral-700 dark:text-neutral-300">{person.full_name?.trim() || person.email}{person.id === currentUserId ? " (you)" : ""}</span>
              {canEditDetails && person.id !== currentUserId ? (
                <form action={removeAction}>
                  <input type="hidden" name="thread_id" value={threadId} />
                  <input type="hidden" name="user_id" value={person.id} />
                  <Button type="submit" variant="ghost" disabled={removing}>Remove</Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {removeState.error ? <Alert tone="error">{removeState.error}</Alert> : null}
        {removeState.success ? <Alert tone="success">{removeState.success}</Alert> : null}
        {viewerIsParticipant ? <LeaveConversation threadId={threadId} label="Leave team" /> : null}
      </div>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close settings</Button>
    </div>
  );
}
