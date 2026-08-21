import Link from "next/link";

import { requireProfile } from "@/modules/auth/session";
import {
  displayName,
  listContactablePeople,
  listThreads,
  threadName,
} from "@/modules/chat/queries";
import { Card, EmptyState } from "@/components/ui";

import { StartConversation } from "./start-conversation";

export const metadata = { title: "Messages · AIC Documents" };

/**
 * The inbox.
 *
 * No permission filter, as everywhere: `listThreads` returns what RLS lets the
 * viewer see, which is the threads they are in.
 */
export default async function MessagesPage() {
  const profile = await requireProfile();
  const [threads, people] = await Promise.all([
    listThreads(profile.id),
    listContactablePeople(profile.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Messages
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Conversations with the rest of the team. Only the people in a
            conversation can read it — administrators included.
          </p>
        </div>
        <StartConversation people={people} />
      </div>

      {threads.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          description="Start one with a colleague. What you say here stays between the people in the thread."
        />
      ) : (
        <ul className="space-y-2">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link href={`/messages/${thread.id}`} className="block">
                <Card className="transition hover:border-neutral-300 dark:hover:border-neutral-700">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                        {threadName(thread, profile.id)}
                      </p>
                      <p className="mt-1 truncate text-sm text-neutral-500 dark:text-neutral-400">
                        {thread.latestMessage ? (
                          <>
                            {thread.latestMessage.sender_id === profile.id
                              ? "You: "
                              : ""}
                            {thread.latestMessage.body}
                          </>
                        ) : (
                          "No messages yet"
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <time
                        dateTime={thread.last_message_at}
                        className="text-xs text-neutral-400 dark:text-neutral-500"
                      >
                        {new Date(thread.last_message_at).toLocaleDateString()}
                      </time>
                      {thread.unreadCount > 0 ? (
                        <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                          {thread.unreadCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {thread.is_group ? (
                    <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                      {thread.participants.map((person) => displayName(person)).join(", ")}
                    </p>
                  ) : null}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
