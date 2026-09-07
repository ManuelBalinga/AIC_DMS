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
  const participantThreads = threads.filter(
    (thread) => thread.viewerIsParticipant,
  );
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
    <div className="flex min-h-screen flex-col bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-ink"
      >
        Skip to content
      </a>

      {/* The header stays put while the page scrolls. Navigation that leaves
          the screen is navigation you scroll back up to find, and on a long
          register that is most of the time somebody spends here. */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto w-full max-w-5xl px-4">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 sm:flex-nowrap">
            <Link
              href="/dashboard"
              className="flex shrink-0 items-center gap-2.5 py-3.5"
              aria-label="AIC Documents, back to documents"
            >
              {/* Drawn in the ink, like everything else. The mark carries the
                  identity through its shape, which is the only signal a
                  monochrome system leaves it. */}
              <svg
                viewBox="0 0 24 24"
                className="size-[22px] shrink-0 text-ink"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="3.5"
                  y="2.5"
                  width="17"
                  height="19"
                  rx="2.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path d="M7.5 2.5v19" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M11 8h6M11 12h6M11 16h3.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  opacity="0.45"
                />
              </svg>
              <span className="text-[15px] font-semibold tracking-[-0.015em] text-ink">
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
                className="hidden max-w-[16ch] truncate rounded-control px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-surface-sunk hover:text-ink lg:inline-block"
                title={profile.email}
              >
                {profile.full_name || profile.email}
              </Link>
              <SignOutButton />
            </div>
          </div>
        </div>
      </header>

      {/* One sheet, the whole app written on it. It runs to the bottom of the
          window rather than stopping under the last entry, because a sheet that
          ends mid-screen reads as a page that failed to load. */}
      <main
        id="main"
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 py-5 sm:px-6 sm:py-8"
      >
        <div className="rise flex flex-1 flex-col rounded-sheet border border-line bg-surface px-4 py-6 shadow-[0_1px_2px_rgba(0,0,0,0.05)] sm:px-8 sm:py-8">
          {children}
        </div>
      </main>

      <ChatRealtimeRefresh
        currentUserId={profile.id}
        participantThreadIds={participantThreads
          .map((thread) => thread.id)
          .join(",")}
      />
      <OfflineRuntime userId={profile.id} />
    </div>
  );
}
