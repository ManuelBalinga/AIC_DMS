import Link from "next/link";

import { deleteConversation } from "@/modules/memory/actions";
import type { Conversation } from "@/lib/types/database";

/**
 * The thread sidebar.
 *
 * Titles come from the opening question, which makes the list readable without
 * anyone naming anything. Threads are listed by last use rather than creation,
 * because a conversation returned to a week later is more findable at the top
 * than buried where it started.
 */
export function ConversationList({
  conversations,
  activeId,
}: {
  conversations: Conversation[];
  activeId: string | null;
}) {
  return (
    <aside className="w-full shrink-0 lg:w-60">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          Conversations
        </p>
        {activeId ? (
          <Link
            href="/ask"
            className="text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            New
          </Link>
        ) : null}
      </div>

      {conversations.length === 0 ? (
        <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
          Questions you ask are kept here, so you can pick a thread back up and
          ask follow-ups.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {conversations.map((conversation) => {
            const active = conversation.id === activeId;

            return (
              <li key={conversation.id} className="group flex items-center gap-1">
                <Link
                  href={`/ask?c=${conversation.id}`}
                  className={`min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-sm ${
                    active
                      ? "bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  }`}
                  title={conversation.title}
                >
                  {conversation.title}
                </Link>

                <form action={deleteConversation}>
                  <input
                    type="hidden"
                    name="conversation_id"
                    value={conversation.id}
                  />
                  <button
                    type="submit"
                    aria-label={`Delete "${conversation.title}"`}
                    className="rounded px-1.5 py-1 text-xs text-neutral-400 opacity-0 hover:bg-neutral-100 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-neutral-800"
                  >
                    ✕
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
