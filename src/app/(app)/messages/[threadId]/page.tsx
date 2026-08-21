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
import { Card } from "@/components/ui";

import { Composer } from "./composer";
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

      <Card>
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            No messages yet. Say something.
          </p>
        ) : (
          <ol className="space-y-4">
            {messages.map((message) => {
              const mine = message.sender_id === profile.id;
              return (
                <li
                  key={message.id}
                  className={mine ? "flex justify-end" : "flex justify-start"}
                >
                  <div className="max-w-[80%]">
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {mine ? "You" : displayName(message.sender)}
                      {" · "}
                      <time dateTime={message.created_at}>
                        {new Date(message.created_at).toLocaleString()}
                      </time>
                    </p>
                    <p
                      className={`mt-1 whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                        mine
                          ? "bg-blue-600 text-white"
                          : "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                      }`}
                    >
                      {message.body}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <Composer threadId={thread.id} />

      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        Ask can quote these messages back to you and the others in this
        conversation, and to nobody else.
      </p>
    </div>
  );
}
