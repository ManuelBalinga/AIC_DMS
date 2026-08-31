import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdministrator } from "@/modules/auth/session";
import { getPersonAccess, listTeamMembers } from "@/modules/users/queries";
import { Badge, Card } from "@/components/ui";
import { MemberRoleForm } from "../../team/member-role-form";
import { ActiveForm } from "../../team/[userId]/active-form";
import { TransferForm } from "../../team/[userId]/transfer-form";

export const metadata = { title: "Person | AIC Documents" };

const ROLE_LABEL = {
  viewer: "Viewer",
  commenter: "Commenter",
  editor: "Editor",
} as const;

/**
 * Everything about one colleague on one screen.
 *
 * Exists to answer "what can this person actually reach?" — the question that
 * comes up when somebody leaves, or when something has been shared that should
 * not have been. Answering it previously meant opening every document in turn.
 */
export default async function PersonPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const admin = await requireAdministrator();

  const members = await listTeamMembers();
  const person = members.find((member) => member.id === userId);
  if (!person) notFound();

  const access = await getPersonAccess(person.id);
  const isSelf = person.id === admin.id;
  const deactivated = person.deactivated_at !== null;

  const transferTargets = members.filter(
    (member) => member.id !== person.id && member.deactivated_at === null,
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href="/admin/people"
          className="text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          ← People
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            {person.full_name || person.email}
          </h1>
          {person.role === "administrator" ? (
            <Badge tone="amber">Administrator</Badge>
          ) : null}
          {deactivated ? <Badge tone="neutral">Deactivated</Badge> : null}
          {isSelf ? <Badge tone="neutral">You</Badge> : null}
        </div>
        {person.full_name ? (
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {person.email}
          </p>
        ) : null}
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Access to the platform
        </h2>
        {isSelf ? (
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            You cannot change your own role or end your own access. Ask another
            administrator.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <MemberRoleForm userId={person.id} currentRole={person.role} />
            <ActiveForm userId={person.id} deactivated={deactivated} />
          </div>
        )}
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          Deactivating ends sign-in. It does not delete anything: their
          documents, the access they granted others and their comments all stay
          exactly as they are, and it can be undone.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Owns {access.owned.length} document{access.owned.length === 1 ? "" : "s"}
        </h2>
        {access.owned.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            Nothing. This account can be deleted safely if it was created in
            error.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-800">
            {access.owned.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
              >
                <Link
                  href={`/documents/${document.id}`}
                  className="min-w-0 truncate text-sm text-neutral-900 hover:underline dark:text-neutral-100"
                >
                  {document.title}
                </Link>
                {deactivated && transferTargets.length > 0 ? (
                  <TransferForm
                    documentId={document.id}
                    candidates={transferTargets.map((member) => ({
                      id: member.id,
                      label: member.full_name || member.email,
                    }))}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {deactivated && access.owned.length > 0 ? (
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            Hand these to whoever picks up the work. Transfer is deliberate and
            one at a time — the right new owner is a judgement about the work,
            not about the org chart.
          </p>
        ) : null}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Can reach {access.shared.length} shared document
          {access.shared.length === 1 ? "" : "s"}
        </h2>
        {access.shared.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            Nothing has been shared with them.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-800">
            {access.shared.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
              >
                <Link
                  href={`/documents/${document.id}`}
                  className="min-w-0 truncate text-sm text-neutral-900 hover:underline dark:text-neutral-100"
                >
                  {document.title}
                </Link>
                <Badge tone="neutral">{ROLE_LABEL[document.role]}</Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          Sharing is changed on each document, by its owner. Listed here so you
          can see the whole picture in one place.
        </p>
      </Card>
    </div>
  );
}
