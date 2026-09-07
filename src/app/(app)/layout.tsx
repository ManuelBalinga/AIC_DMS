import Link from "next/link";

import { requireProfile } from "@/modules/auth/session";
import {
  listThreads,
  listUnreadChatNotifications,
} from "@/modules/chat/queries";
import { ChatRealtimeRefresh } from "@/modules/chat/realtime-refresh";
import { listVisibleTags } from "@/modules/documents/queries";
import { NotificationCenter } from "./notification-center";
import { NavLinks, NavTags } from "./nav-links";
import { SignOutButton } from "./sign-out-button";
import { OfflineRuntime } from "@/modules/offline/offline-runtime";

function Wordmark() {
  return (
    <Link
      href="/dashboard"
      className="flex shrink-0 items-center gap-2.5 rounded-control px-2.5 py-2 text-[14.5px] font-semibold tracking-[-0.015em] text-ink"
      aria-label="AIC Documents, back to documents"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-[19px] shrink-0"
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
          strokeWidth="1.6"
        />
        <path d="M7.5 2.5v19" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M11 8h6M11 12h6M11 16h3.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.4"
        />
      </svg>
      AIC Documents
    </Link>
  );
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const isAdmin = profile.role === "administrator";
  const [threads, notificationResult, tags] = await Promise.all([
    listThreads(profile.id),
    listUnreadChatNotifications(),
    listVisibleTags(),
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

  const rail = (
    <>
      <Wordmark />
      <div className="mt-4">
        <NavLinks items={sections} />
      </div>
      <NavTags tags={tags} />
    </>
  );

  return (
    <div className="min-h-screen bg-surface">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-ink"
      >
        Skip to content
      </a>

      <div className="mx-auto flex w-full max-w-[1240px] flex-col lg:flex-row">
        {/*
         * The rail, on a screen wide enough to hold one.
         *
         * It replaces a tab strip that was already full at five sections with
         * Teams still unbuilt — a rail grows downward, which is the direction
         * this product is growing. It is sticky and full-height so navigation
         * never scrolls away from a long register.
         */}
        <aside className="sticky top-0 hidden h-screen w-[228px] shrink-0 flex-col border-r border-line bg-surface-sunk px-3 py-4 lg:flex">
          {rail}
          <div className="mt-auto flex flex-col gap-0.5 border-t border-line pt-3">
            <Link
              href="/account"
              className="truncate rounded-control px-2.5 py-2 text-[13px] text-ink-soft transition-colors hover:bg-surface/70 hover:text-ink"
              title={profile.email}
            >
              {profile.full_name || profile.email}
            </Link>
            <SignOutButton />
          </div>
        </aside>

        {/*
         * Below `lg` the rail becomes a disclosure rather than shrinking.
         * `<details>` gives a real toggle with keyboard and screen-reader
         * behaviour already correct, and without shipping a byte of JavaScript
         * to do what the element does natively.
         */}
        <details className="group border-b border-line bg-surface-sunk lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
            <Wordmark />
            <span className="flex items-center gap-1">
              <NotificationCenter
                notifications={notificationResult.notifications}
                count={notificationResult.count}
              />
              <span className="rounded-control border border-control px-2.5 py-1.5 text-[13px] text-ink">
                Menu
              </span>
            </span>
          </summary>
          <div className="px-3 pb-4">
            <div className="mt-1">
              <NavLinks items={sections} />
            </div>
            <NavTags tags={tags} />
            <div className="mt-4 flex flex-col gap-0.5 border-t border-line pt-3">
              <Link
                href="/account"
                className="truncate rounded-control px-2.5 py-2 text-[13px] text-ink-soft"
              >
                {profile.full_name || profile.email}
              </Link>
              <SignOutButton />
            </div>
          </div>
        </details>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Notifications sit at the top of the reading column on a wide
              screen, where the rail has no room for them without competing
              with navigation. On a narrow one they are already in the bar. */}
          <div className="hidden items-center justify-end px-6 pt-4 lg:flex">
            <NotificationCenter
              notifications={notificationResult.notifications}
              count={notificationResult.count}
            />
          </div>

          <main
            id="main"
            className="rise flex min-w-0 flex-1 flex-col px-3 py-5 sm:px-6 sm:py-6 lg:pt-3"
          >
            {children}
          </main>
        </div>
      </div>

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
