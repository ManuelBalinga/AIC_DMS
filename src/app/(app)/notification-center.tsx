import { openChatNotification } from "@/modules/chat/actions";
import { displayName, type ChatNotificationSummary } from "@/modules/chat/queries";

export function NotificationCenter({
  notifications,
  count,
}: {
  notifications: ChatNotificationSummary[];
  count: number;
}) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100">
        Notifications
        {count > 0 ? (
          <span className="ml-1.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        {notifications.length === 0 ? (
          <p className="px-3 py-4 text-sm text-neutral-500 dark:text-neutral-400">
            No unread mentions or replies.
          </p>
        ) : (
          <ul className="space-y-1">
            {notifications.map((notification) => (
              <li key={notification.id}>
                <form action={openChatNotification}>
                  <input type="hidden" name="notification_id" value={notification.id} />
                  <button
                    type="submit"
                    className="w-full rounded-lg px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {displayName(notification.actor)}
                      {notification.kind === "mention"
                        ? " mentioned you"
                        : " replied to you"}
                    </span>
                    <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
                      {notification.thread.kind === "team"
                        ? `# ${notification.thread.topic || "Untitled team"}`
                        : "Direct conversation"}
                      {" - "}
                      {new Date(notification.created_at).toLocaleString()}
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
