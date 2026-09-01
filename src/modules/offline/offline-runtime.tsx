"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { clearOfflineData } from "./storage";
import { revalidateOfflineDocuments } from "./sync";
import { flushQueuedUploads } from "./upload-queue";

export function OfflineRuntime({ userId }: { userId: string }) {
  const router = useRouter();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js");
    }

    const sync = async () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine) {
        await revalidateOfflineDocuments(userId).catch(() => undefined);
        const result = await flushQueuedUploads(userId).catch(() => undefined);
        if (result?.completed) router.refresh();
      }
    };
    void sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);

    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") void clearOfflineData();
    });
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      data.subscription.unsubscribe();
    };
  }, [router, userId]);

  return offline ? (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md">
      <Alert tone="warning">You are offline. Saved documents remain readable and new uploads will queue on this device.</Alert>
    </div>
  ) : null;
}
