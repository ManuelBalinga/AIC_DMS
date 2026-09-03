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
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-[2px] px-2.5 py-1.5 text-sm text-parchment transition-colors hover:bg-cloth-edge hover:text-page">
        <svg
          viewBox="0 0 16 16"
          className="size-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 6.6a4 4 0 0 1 8 0c0 2.5.7 3.7 1.3 4.4H2.7C3.3 10.3 4 9.1 4 6.6Z" />
          <path d="M6.6 13.2a1.6 1.6 0 0 0 2.8 0" />
        </svg>
        <span className="hidden sm:inline">Notifications</span>
        <span className="sr-only sm:hidden">Notifications</span>
        {count > 0 ? (
          <span className="rounded-[2px] bg-brass px-1.5 py-px text-[11px] font-bold leading-tight text-cloth-deep">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-80 rounded-[2px] border border-rule-faint bg-page p-2 shadow-[0_6px_18px_rgba(36,31,20,0.22)]">
        {notifications.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-soft">
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
                    className="w-full rounded-[2px] px-3 py-2 text-left transition-colors hover:bg-brass/[0.09]"
                  >
                    <span className="block text-sm font-medium text-ink">
                      {displayName(notification.actor)}
                      {notification.kind === "mention"
                        ? " mentioned you"
                        : " replied to you"}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-soft">
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
