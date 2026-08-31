import Link from "next/link";
import { notFound } from "next/navigation";

import { requireProfile } from "@/modules/auth/session";
import { markThreadRead } from "@/modules/chat/actions";
import {
  displayName,
  getThread,
  listContactablePeople,
  listMessages,
  listReferenceableDocuments,
  threadName,
} from "@/modules/chat/queries";
import { Card } from "@/components/ui";
import { getTeamDocumentGrantCount } from "@/modules/access/queries";

import { ConversationView } from "./conversation-view";
import { JoinTeamButton } from "../join-team-button";
import { DirectSettings, TeamSettings } from "./thread-settings";
import { PromotionForm } from "./promotion-form";

export const maxDuration = 60;

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const profile = await requireProfile();

  const thread = await getThread(threadId, profile.id);

  // Null covers both "no such thread" and "not yours", deliberately. A
  // distinguishable response would confirm that a conversation exists, which is
  // itself something the viewer is not entitled to know.
  if (!thread) notFound();

  const isTeam = thread.kind === "team";
  const canReadConversation = thread.viewerIsParticipant ||
    (isTeam && thread.visibility === "open");
  const membershipOnly = isTeam && thread.visibility === "closed" &&
    !thread.viewerIsParticipant && profile.role === "administrator";

  if (!canReadConversation && !membershipOnly) notFound();

  const [messages, people, teamDocumentCount, referenceableDocuments] = await Promise.all([
    canReadConversation ? listMessages(threadId) : Promise.resolve([]),
    isTeam ? listContactablePeople(profile.id) : Promise.resolve([]),
    isTeam && (thread.viewerIsParticipant || profile.role === "administrator")
      ? getTeamDocumentGrantCount(threadId)
      : Promise.resolve(0),
    canReadConversation ? listReferenceableDocuments() : Promise.resolve([]),
  ]);

  // Opening a thread is reading it. Deliberately not awaited into the render
  // path's critical section — a failed read-receipt must not blank the page.
  if (thread.viewerIsParticipant) await markThreadRead(threadId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/messages"
            className="text-sm text-neutral-500 hover:underline dark:text-neutral-400"
          >
            ← Messages
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            {isTeam ? "# " : ""}{threadName(thread, profile.id)}
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {isTeam && thread.purpose ? thread.purpose : thread.participants.map((person) => displayName(person)).join(", ")}
          </p>
        </div>
        {isTeam ? (
          thread.viewerIsParticipant || profile.role === "administrator" ? (
            <TeamSettings
              threadId={thread.id}
              name={thread.topic ?? "Untitled team"}
              purpose={thread.purpose}
              visibility={thread.visibility ?? "closed"}
              participants={thread.participants}
              people={people}
              currentUserId={profile.id}
              viewerIsParticipant={thread.viewerIsParticipant}
              canEditDetails={thread.created_by === profile.id || profile.role === "administrator"}
              teamDocumentCount={teamDocumentCount}
            />
          ) : (
            <JoinTeamButton threadId={thread.id} />
          )
        ) : (
          <DirectSettings />
        )}
      </div>

      {membershipOnly ? (
        <Card className="p-5">
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Membership management</h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">As an administrator you can manage who belongs to this closed team, but its conversation remains private to members.</p>
        </Card>
      ) : (
        <>
          {thread.viewerIsParticipant ? (
            <PromotionForm
              threadId={thread.id}
              defaultTitle={`${threadName(thread, profile.id)} discussion`}
              isTeam={isTeam}
            />
          ) : null}
          <ConversationView
            threadId={thread.id}
            messages={messages}
            participants={thread.participants}
            currentUserId={profile.id}
            canParticipate={thread.viewerIsParticipant}
            referenceableDocuments={referenceableDocuments}
            teamVisibility={isTeam ? thread.visibility : null}
          />
        </>
      )}

      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        {isTeam
          ? "Ask can use Team discussions within the same visibility boundary."
          : "Direct messages are never used as an Ask source."}
      </p>
    </div>
  );
}
