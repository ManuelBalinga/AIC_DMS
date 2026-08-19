import { requireAdministrator } from "@/modules/auth/session";
import { listPendingInvitations, listTeamMembers } from "@/modules/users/queries";
import { Badge, Card } from "@/components/ui";
import { InviteForm } from "./invite-form";
import { PendingInvitations } from "./pending-invitations";
import { MemberRoleForm } from "./member-role-form";

export const metadata = { title: "Team | AIC Documents" };

export default async function TeamPage() {
  const admin = await requireAdministrator();
  const [members, invitations] = await Promise.all([
    listTeamMembers(),
    listPendingInvitations(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Team
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          People join by invitation only. There is no public sign-up.
        </p>
      </div>

      <InviteForm />

      {invitations.length > 0 ? <PendingInvitations invitations={invitations} /> : null}

      <Card>
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Members ({members.length})
          </h2>
        </div>
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm text-neutral-900 dark:text-neutral-100">
                    {member.full_name || member.email}
                  </p>
                  {member.role === "administrator" ? (
                    <Badge tone="amber">Administrator</Badge>
                  ) : null}
                  {member.id === admin.id ? <Badge tone="neutral">You</Badge> : null}
                </div>
                {member.full_name ? (
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {member.email}
                  </p>
                ) : null}
              </div>

              {member.id === admin.id ? null : (
                <MemberRoleForm userId={member.id} currentRole={member.role} />
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
