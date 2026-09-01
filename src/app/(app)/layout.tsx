import Link from "next/link";

import { requireProfile } from "@/modules/auth/session";
import {
  listThreads,
  listUnreadChatNotifications,
} from "@/modules/chat/queries";
import { ChatRealtimeRefresh } from "@/modules/chat/realtime-refresh";
import { NotificationCenter } from "./notification-center";
import { SignOutButton } from "./sign-out-button";
import { OfflineRuntime } from "@/modules/offline/offline-runtime";

const NAV_LINK =
  "rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const isAdmin = profile.role === "administrator";
  const [threads, notificationResult] = await Promise.all([
    listThreads(profile.id),
    listUnreadChatNotifications(),
  ]);
  const participantThreads = threads.filter((thread) => thread.viewerIsParticipant);
  const unread = participantThreads.reduce(
    (total, thread) => total + thread.unreadCount,
    0,
  );

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <nav className="flex items-center gap-1">
            <Link
              href="/dashboard"
              className="mr-3 text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
            >
              AIC Documents
            </Link>
            <Link href="/dashboard" className={NAV_LINK}>
              Documents
            </Link>
            <Link href="/ask" className={NAV_LINK}>
              Ask
            </Link>
            <Link href="/messages" className={`${NAV_LINK} flex items-center gap-1.5`}>
              Messages
              {unread > 0 ? (
                <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </Link>
            <Link href="/offline" className={NAV_LINK}>
              Offline
            </Link>
            {isAdmin ? (
              <Link href="/admin/people" className={NAV_LINK}>
                People
              </Link>
            ) : null}
          </nav>

          <div className="flex items-center gap-3">
            <NotificationCenter
              notifications={notificationResult.notifications}
              count={notificationResult.count}
            />
            <Link
              href="/account"
              className="hidden text-sm text-neutral-500 hover:text-neutral-900 sm:inline dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              {profile.full_name || profile.email}
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      <ChatRealtimeRefresh
        currentUserId={profile.id}
        participantThreadIds={participantThreads.map((thread) => thread.id).join(",")}
      />
      <OfflineRuntime userId={profile.id} />
    </div>
  );
}
