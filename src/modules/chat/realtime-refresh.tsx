"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const REFRESH_DEBOUNCE_MS = 150;
const NOTICE_DURATION_MS = 4_000;

type ChangePayload = { new: Record<string, unknown> };

/** Re-fetches RLS-protected server projections after a permitted change. */
export function ChatRealtimeRefresh({
  currentUserId,
  participantThreadIds,
}: {
  currentUserId: string;
  participantThreadIds: string;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const participantThreads = new Set(participantThreadIds.split(",").filter(Boolean));
    const supabase = createClient();
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
    };
    const refreshParticipantThread = (payload: unknown) => {
      const change = payload as ChangePayload;
      const threadId =
        typeof change.new.thread_id === "string" ? change.new.thread_id : null;
      if (threadId && participantThreads.has(threadId)) scheduleRefresh();
    };

    const channel = supabase
      .channel(`chat-live:${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        refreshParticipantThread,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages" },
        refreshParticipantThread,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_notifications",
          filter: `recipient_id=eq.${currentUserId}`,
        },
        () => {
          scheduleRefresh();
          setNotice("You have a new mention or reply.");
          if (noticeTimer.current) clearTimeout(noticeTimer.current);
          noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
        },
      )
      .subscribe();

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, participantThreadIds, router]);

  return notice ? (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm font-medium text-neutral-900 shadow-lg dark:border-blue-900 dark:bg-neutral-900 dark:text-neutral-100"
    >
      {notice}
    </div>
  ) : null;
}
