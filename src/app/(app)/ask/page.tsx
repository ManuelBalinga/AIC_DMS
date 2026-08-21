import { notFound } from "next/navigation";

import { requireProfile } from "@/modules/auth/session";
import { getDocumentStats } from "@/modules/documents/queries";
import { embeddingsConfigured } from "@/modules/rag/embed";
import { anthropicConfigured } from "@/modules/rag/answer";
import { getConversation, getThread, listConversations } from "@/modules/memory/queries";
import { Alert } from "@/components/ui";
import { AskPanel, type ThreadMessage } from "./ask-panel";
import { ConversationList } from "./conversation-list";

export const metadata = { title: "Ask | AIC Documents" };

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const profile = await requireProfile();
  const { c: conversationId } = await searchParams;

  const [stats, conversations] = await Promise.all([
    getDocumentStats(profile.id),
    listConversations(),
  ]);

  // An unknown id is a 404 rather than a silent redirect to a blank thread:
  // the link was to something specific, and pretending otherwise hides whether
  // the thread was deleted or never existed.
  const conversation = conversationId ? await getConversation(conversationId) : null;
  if (conversationId && !conversation) notFound();

  const thread = conversation ? await getThread(conversation.id) : [];

  const initialMessages: ThreadMessage[] = thread.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    sources: message.citations.map((citation) => ({
      number: citation.position,
      kind: citation.kind,
      documentId: citation.document_id,
      threadId: citation.thread_id,
      documentTitle: citation.document_title,
      pageNumber: citation.page_number,
      excerpt: citation.excerpt,
    })),
  }));

  const missing: string[] = [];
  if (!embeddingsConfigured()) missing.push("an embedding provider key");
  if (!anthropicConfigured()) missing.push("an ANTHROPIC_API_KEY");

  return (
    <div className="flex flex-col gap-8 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            {conversation ? conversation.title : "Ask the documents"}
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {stats.indexed === 0
              ? "No documents are indexed yet."
              : `${stats.indexed} document${stats.indexed === 1 ? "" : "s"} indexed` +
                (stats.awaitingIndex > 0
                  ? `, ${stats.awaitingIndex} still being processed`
                  : "")}
          </p>
        </div>

        {missing.length > 0 ? (
          <Alert tone="error">
            AI answering is not configured on this environment — it is missing{" "}
            {missing.join(" and ")}. Questions will still run a keyword search
            where possible.
          </Alert>
        ) : null}

        <AskPanel
          key={conversation?.id ?? "new"}
          conversationId={conversation?.id ?? null}
          initialMessages={initialMessages}
        />
      </div>

      <ConversationList
        conversations={conversations}
        activeId={conversation?.id ?? null}
      />
    </div>
  );
}
