import Link from "next/link";
import { notFound } from "next/navigation";

import { requireProfile } from "@/modules/auth/session";
import { markThreadRead } from "@/modules/chat/actions";
import {
  displayName,
  getThread,
  listMessages,
  threadName,
} from "@/modules/chat/queries";

import { ConversationView } from "./conversation-view";
import { ThreadSettings } from "./thread-settings";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const profile = await requireProfile();

  const thread = await getThread(threadId);

  // Null covers both "no such thread" and "not yours", deliberately. A
  // distinguishable response would confirm that a conversation exists, which is
  // itself something the viewer is not entitled to know.
  if (!thread) notFound();

  const messages = await listMessages(threadId);

  // Opening a thread is reading it. Deliberately not awaited into the render
  // path's critical section — a failed read-receipt must not blank the page.
  await markThreadRead(threadId);

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
            {threadName(thread, profile.id)}
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {thread.participants.map((person) => displayName(person)).join(", ")}
          </p>
        </div>
        <ThreadSettings threadId={thread.id} topic={thread.topic} />
      </div>

      <ConversationView
        threadId={thread.id}
        messages={messages}
        participants={thread.participants}
        currentUserId={profile.id}
      />

      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        Ask can quote these messages back to you and the others in this
        conversation, and to nobody else.
      </p>
    </div>
  );
}
