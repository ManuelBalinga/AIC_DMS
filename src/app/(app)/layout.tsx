import Link from "next/link";

import { requireProfile } from "@/modules/auth/session";
import {
  listThreads,
  listUnreadChatNotifications,
} from "@/modules/chat/queries";
import { ChatRealtimeRefresh } from "@/modules/chat/realtime-refresh";
import { NotificationCenter } from "./notification-center";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";
import { OfflineRuntime } from "@/modules/offline/offline-runtime";

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

  const sections = [
    { href: "/dashboard", label: "Documents" },
    { href: "/ask", label: "Ask" },
    { href: "/messages", label: "Messages", badge: unread },
    { href: "/offline", label: "Offline" },
    ...(isAdmin ? [{ href: "/admin/people", label: "People" }] : []),
  ];

  return (
    <div className="flex min-h-screen flex-col bg-page-sunk">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[2px] focus:bg-page focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink"
      >
        Skip to content
      </a>

      {/* The binding. One row once there is room for one; on a narrow screen
          the identity and account controls hold the top and the section tabs
          take their own scrolling row beneath, because a tab strip that runs
          off the edge of its own band is worse than a tab strip that scrolls. */}
      <header className="border-b-2 border-brass-deep/50 bg-cloth">
        <div className="mx-auto w-full max-w-5xl px-4">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 sm:flex-nowrap">
            <Link
              href="/dashboard"
              className="flex shrink-0 items-center gap-2.5 py-3"
              aria-label="AIC Documents, back to documents"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-[22px] shrink-0"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="3.5"
                  y="2.5"
                  width="17"
                  height="19"
                  rx="1"
                  className="stroke-brass"
                  strokeWidth="1.5"
                />
                <path d="M7.5 2.5v19" className="stroke-brass" strokeWidth="1.5" />
                <path
                  d="M11 8h6M11 12h6M11 16h3.5"
                  className="stroke-parchment-soft"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span className="text-[15px] font-semibold tracking-[-0.015em] text-page">
                AIC Documents
              </span>
            </Link>

            {/* Nav sits between identity and account on wide screens, and drops
                to its own full-width row below them on narrow ones. */}
            <div className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 sm:order-none sm:mx-0 sm:w-auto sm:flex-1 sm:overflow-visible sm:px-0">
              <NavLinks items={sections} />
            </div>

            <div className="flex shrink-0 items-center gap-1 py-1.5 sm:py-0">
              <NotificationCenter
                notifications={notificationResult.notifications}
                count={notificationResult.count}
              />
              <Link
                href="/account"
                className="hidden max-w-[16ch] truncate px-2 text-sm text-parchment transition-colors hover:text-page lg:inline-block"
                title={profile.email}
              >
                {profile.full_name || profile.email}
              </Link>
              <SignOutButton />
            </div>
          </div>
        </div>
      </header>

      {/* The open page: one continuous sheet the whole app is written on. */}
      {/* The sheet runs to the bottom of the window rather than stopping under
          the last entry, because a ledger page that ends mid-screen reads as a
          page that failed to load. */}
      <main
        id="main"
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 py-6 sm:px-6 sm:py-8"
      >
        <div className="flex-1 rounded-[2px] border border-rule-faint bg-page px-4 py-6 shadow-[0_1px_3px_rgba(36,31,20,0.09)] sm:px-8 sm:py-8">
          {children}
        </div>
      </main>

      <ChatRealtimeRefresh
        currentUserId={profile.id}
        participantThreadIds={participantThreads.map((thread) => thread.id).join(",")}
      />
      <OfflineRuntime userId={profile.id} />
    </div>
  );
}
