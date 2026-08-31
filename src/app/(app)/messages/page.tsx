import Link from "next/link";

import { requireProfile } from "@/modules/auth/session";
import {
  displayName,
  listContactablePeople,
  listThreads,
  threadName,
  type ThreadSummary,
} from "@/modules/chat/queries";
import { Badge, Card, EmptyState } from "@/components/ui";

import { CreateTeam } from "./create-team";
import { JoinTeamButton } from "./join-team-button";
import { StartConversation } from "./start-conversation";

export const metadata = { title: "Messages · AIC Documents" };

function LatestMessage({ thread, viewerId }: { thread: ThreadSummary; viewerId: string }) {
  if (!thread.latestMessage) return <span>No messages yet</span>;
  return <>{thread.latestMessage.sender_id === viewerId ? "You: " : ""}{thread.latestMessage.body}</>;
}

function ThreadMeta({ thread }: { thread: ThreadSummary }) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <time dateTime={thread.last_message_at} className="text-xs text-neutral-400 dark:text-neutral-500">
        {new Date(thread.last_message_at).toLocaleDateString()}
      </time>
      {thread.unreadCount > 0 ? (
        <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
          {thread.unreadCount}
        </span>
      ) : null}
    </div>
  );
}

function DirectList({ threads, viewerId }: { threads: ThreadSummary[]; viewerId: string }) {
  if (threads.length === 0) {
    return <p className="rounded-xl border border-dashed border-neutral-300 px-4 py-6 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">No direct conversations yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {threads.map((thread) => (
        <li key={thread.id}>
          <Link href={`/messages/${thread.id}`} className="block">
            <Card className="p-4 transition hover:border-neutral-300 dark:hover:border-neutral-700">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{threadName(thread, viewerId)}</p>
                  <p className="mt-1 truncate text-sm text-neutral-500 dark:text-neutral-400"><LatestMessage thread={thread} viewerId={viewerId} /></p>
                </div>
                <ThreadMeta thread={thread} />
              </div>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TeamList({ threads, viewerId, isAdmin }: { threads: ThreadSummary[]; viewerId: string; isAdmin: boolean }) {
  if (threads.length === 0) {
    return <p className="rounded-xl border border-dashed border-neutral-300 px-4 py-6 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">No teams yet. Create the first space for an AIC workstream.</p>;
  }
  return (
    <ul className="space-y-2">
      {threads.map((thread) => {
        const membershipOnly = isAdmin && thread.visibility === "closed" && !thread.viewerIsParticipant;
        return (
          <li key={thread.id}>
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <Link href={`/messages/${thread.id}`} className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-neutral-900 dark:text-neutral-100"># {threadName(thread, viewerId)}</p>
                    <Badge tone={thread.visibility === "open" ? "green" : "neutral"}>{thread.visibility === "open" ? "Open" : "Closed"}</Badge>
                    {thread.viewerIsParticipant ? <Badge tone="blue">Member</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{thread.purpose || "No purpose added yet."}</p>
                  <p className="mt-2 truncate text-sm text-neutral-500 dark:text-neutral-400">
                    {membershipOnly ? "Membership management only — conversation content remains private." : <LatestMessage thread={thread} viewerId={viewerId} />}
                  </p>
                  {thread.participants.length > 0 ? <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">{thread.participants.map((person) => displayName(person)).join(", ")}</p> : null}
                </Link>
                <div className="flex flex-col items-end gap-2">
                  <ThreadMeta thread={thread} />
                  {thread.visibility === "open" && !thread.viewerIsParticipant ? <JoinTeamButton threadId={thread.id} /> : null}
                </div>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export default async function MessagesPage() {
  const profile = await requireProfile();
  const [threads, people] = await Promise.all([listThreads(profile.id), listContactablePeople(profile.id)]);
  const teams = threads.filter((thread) => thread.kind === "team");
  const directMessages = threads.filter((thread) => thread.kind === "direct");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Messages</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">Teams hold shared work; direct messages stay between their participants.</p>
        </div>
        <div className="flex flex-wrap items-start gap-2"><StartConversation people={people} /><CreateTeam /></div>
      </div>

      {threads.length === 0 ? (
        <EmptyState title="No conversations yet" description="Create a team for a workstream or start a direct conversation with a colleague." />
      ) : (
        <>
          <section className="space-y-3" aria-labelledby="teams-heading">
            <div>
              <h2 id="teams-heading" className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Teams</h2>
              <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">Open teams are readable by everyone. Closed teams are private to members.</p>
            </div>
            <TeamList threads={teams} viewerId={profile.id} isAdmin={profile.role === "administrator"} />
          </section>
          <section className="space-y-3" aria-labelledby="direct-heading">
            <h2 id="direct-heading" className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Direct</h2>
            <DirectList threads={directMessages} viewerId={profile.id} />
          </section>
        </>
      )}
    </div>
  );
}
