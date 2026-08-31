"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  changeDocumentRole,
  changeTeamDocumentRole,
  grantDocumentAccess,
  grantTeamDocumentAccess,
  revokeDocumentAccess,
  revokeTeamDocumentAccess,
} from "@/modules/access/actions";
import { emptyActionState } from "@/lib/action-state";
import type {
  DocumentGrant,
  DocumentTeamGrant,
  ShareableTeam,
} from "@/modules/access/queries";
import type { DocumentRole, Profile } from "@/lib/types/database";
import { Alert, Button, Card, Label, Select } from "@/components/ui";

/**
 * What each role permits, in the words of the person choosing it.
 *
 * Written as consequences rather than capability names — "can suggest changes
 * but not make them" is a decision somebody can take; "commenter" is a label
 * they have to look up.
 */
const ROLE_OPTIONS: { value: DocumentRole; label: string; hint: string }[] = [
  { value: "viewer", label: "Viewer", hint: "Read and download it" },
  { value: "commenter", label: "Commenter", hint: "Read it and leave comments" },
  { value: "editor", label: "Editor", hint: "Change its details and replace the file" },
];

function GrantButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Sharing..." : "Share"}
    </Button>
  );
}

function RevokeButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" disabled={pending}>
      {pending ? "Removing..." : "Remove"}
    </Button>
  );
}

export function SharePanel({
  documentId,
  grants,
  teamGrants,
  shareableMembers,
  shareableTeams,
}: {
  documentId: string;
  grants: DocumentGrant[];
  teamGrants: DocumentTeamGrant[];
  shareableMembers: Profile[];
  shareableTeams: ShareableTeam[];
}) {
  const [grantState, grantAction] = useActionState(
    grantDocumentAccess,
    emptyActionState,
  );
  const [revokeState, revokeAction] = useActionState(
    revokeDocumentAccess,
    emptyActionState,
  );
  const [roleState, roleAction] = useActionState(
    changeDocumentRole,
    emptyActionState,
  );
  const [teamGrantState, teamGrantAction] = useActionState(
    grantTeamDocumentAccess,
    emptyActionState,
  );
  const [teamRevokeState, teamRevokeAction] = useActionState(
    revokeTeamDocumentAccess,
    emptyActionState,
  );
  const [teamRoleState, teamRoleAction] = useActionState(
    changeTeamDocumentRole,
    emptyActionState,
  );

  return (
    <Card className="p-5">
      <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        Who can see this
      </h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Share directly with one person or with a Team. Team membership is live:
        joining inherits its documents and leaving withdraws them. Administrators
        can manage access but cannot read unless they receive a grant.
      </p>

      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        Share with a person
      </h3>

      <form action={grantAction} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="document_id" value={documentId} />
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="user_id">Add a team member</Label>
          <Select id="user_id" name="user_id" required disabled={shareableMembers.length === 0}>
            {shareableMembers.length === 0 ? (
              <option value="">Everyone already has access</option>
            ) : (
              <>
                <option value="">Choose someone...</option>
                {shareableMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name ? `${member.full_name} (${member.email})` : member.email}
                  </option>
                ))}
              </>
            )}
          </Select>
        </div>
        <div className="w-44 space-y-1.5">
          <Label htmlFor="role">Can</Label>
          <Select id="role" name="role" defaultValue="viewer">
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} — {option.hint.toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <GrantButton />
      </form>

      {grantState.error ? (
        <div className="mt-3">
          <Alert tone="error">{grantState.error}</Alert>
        </div>
      ) : null}
      {grantState.success ? (
        <div className="mt-3">
          <Alert tone="success">{grantState.success}</Alert>
        </div>
      ) : null}
      {revokeState.error ? (
        <div className="mt-3">
          <Alert tone="error">{revokeState.error}</Alert>
        </div>
      ) : null}
      {roleState.error ? (
        <div className="mt-3">
          <Alert tone="error">{roleState.error}</Alert>
        </div>
      ) : null}
      {roleState.success ? (
        <div className="mt-3">
          <Alert tone="success">{roleState.success}</Alert>
        </div>
      ) : null}

      <div className="mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-800">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          Share with a Team
        </h3>
        <form action={teamGrantAction} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="document_id" value={documentId} />
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="team_id">Team</Label>
            <Select id="team_id" name="team_id" required disabled={shareableTeams.length === 0}>
              {shareableTeams.length === 0 ? (
                <option value="">Every available Team already has access</option>
              ) : (
                <>
                  <option value="">Choose a Team...</option>
                  {shareableTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.topic || "Untitled Team"} ({team.visibility})
                    </option>
                  ))}
                </>
              )}
            </Select>
          </div>
          <div className="w-44 space-y-1.5">
            <Label htmlFor="team_role">Can</Label>
            <Select id="team_role" name="role" defaultValue="viewer">
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.hint.toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <GrantButton />
        </form>
        {teamGrantState.error ? <div className="mt-3"><Alert tone="error">{teamGrantState.error}</Alert></div> : null}
        {teamGrantState.success ? <div className="mt-3"><Alert tone="success">{teamGrantState.success}</Alert></div> : null}
        {teamRevokeState.error ? <div className="mt-3"><Alert tone="error">{teamRevokeState.error}</Alert></div> : null}
        {teamRoleState.error ? <div className="mt-3"><Alert tone="error">{teamRoleState.error}</Alert></div> : null}
        {teamRoleState.success ? <div className="mt-3"><Alert tone="success">{teamRoleState.success}</Alert></div> : null}
      </div>

      {grants.length > 0 ? (
        <ul className="mt-5 divide-y divide-neutral-200 border-t border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {grants.map((grant) => (
            <li
              key={grant.user_id}
              className="flex items-center justify-between gap-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-neutral-900 dark:text-neutral-100">
                  {grant.profile?.full_name || grant.profile?.email || "Unknown user"}
                </p>
                {grant.profile?.full_name ? (
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {grant.profile.email}
                  </p>
                ) : null}
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Source: Direct grant
                </p>
              </div>
              <div className="flex items-center gap-2">
                <form action={roleAction}>
                  <input type="hidden" name="document_id" value={documentId} />
                  <input type="hidden" name="user_id" value={grant.user_id} />
                  <Select
                    name="role"
                    defaultValue={grant.role}
                    aria-label={`What ${grant.profile?.full_name || grant.profile?.email || "this person"} can do`}
                    className="w-32 text-xs"
                    // Submitting on change keeps this to one interaction; a
                    // separate Save button beside a dropdown is a button people
                    // forget to press, which silently discards the change.
                    onChange={(event) => event.currentTarget.form?.requestSubmit()}
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </form>
                <form action={revokeAction}>
                  <input type="hidden" name="document_id" value={documentId} />
                  <input type="hidden" name="user_id" value={grant.user_id} />
                  <RevokeButton />
                </form>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 border-t border-neutral-200 pt-4 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          Not shared with anyone yet.
        </p>
      )}

      {teamGrants.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Team access
          </h3>
          <ul className="mt-2 divide-y divide-neutral-200 border-t border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {teamGrants.map((grant) => (
              <li key={grant.team_id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-neutral-900 dark:text-neutral-100">
                    {grant.team?.topic || "Private Team"}
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Source: Team membership{grant.team?.visibility ? ` · ${grant.team.visibility}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <form action={teamRoleAction}>
                    <input type="hidden" name="document_id" value={documentId} />
                    <input type="hidden" name="team_id" value={grant.team_id} />
                    <Select
                      name="role"
                      defaultValue={grant.role}
                      aria-label={`What ${grant.team?.topic || "this Team"} can do`}
                      className="w-32 text-xs"
                      onChange={(event) => event.currentTarget.form?.requestSubmit()}
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </Select>
                  </form>
                  <form action={teamRevokeAction}>
                    <input type="hidden" name="document_id" value={documentId} />
                    <input type="hidden" name="team_id" value={grant.team_id} />
                    <RevokeButton />
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
