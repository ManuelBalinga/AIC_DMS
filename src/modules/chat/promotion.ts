import type { ChatThreadKind } from "@/lib/types/database";

export const MAX_PROMOTION_TITLE_LENGTH = 200;
export const PROMOTION_PAGE_SIZE = 500;

export type PromotionMessage = {
  id: string;
  body: string;
  parent_id: string | null;
  created_at: string;
  edited_at: string | null;
  retracted_at: string | null;
  sender: { full_name: string | null; email: string } | null;
};

function senderName(message: PromotionMessage): string {
  return message.sender?.full_name?.trim() || message.sender?.email || "A former colleague";
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\\x60*_{}[\]()#+.!|~-])/g, "\\$1");
}

function quotedBody(message: PromotionMessage): string[] {
  const body = message.retracted_at ? "[Message retracted]" : message.body;
  return body.split(/\r?\n/).map((line) => "> " + escapeMarkdown(line));
}

/** Build the immutable Markdown snapshot stored and indexed as the document. */
export function buildPromotedThreadMarkdown({
  title,
  threadKind,
  threadName,
  promotedAt,
  messages,
}: {
  title: string;
  threadKind: ChatThreadKind;
  threadName: string;
  promotedAt: string;
  messages: PromotionMessage[];
}): string {
  const source = threadKind === "team"
    ? "Team #" + escapeMarkdown(threadName)
    : "direct conversation";
  const byId = new Map(messages.map((message) => [message.id, message]));
  const countLabel = messages.length === 1 ? "message" : "messages";
  const lines = [
    "# " + escapeMarkdown(title),
    "",
    "> Promoted from " + source + " on " + new Date(promotedAt).toISOString() + ".",
    "> This is a snapshot of " + messages.length + " " + countLabel + "; later conversation changes do not rewrite this document.",
    "> Document-reference cards are not copied; open the source conversation to review them within their live permissions.",
    "",
  ];

  for (const message of messages) {
    const parent = message.parent_id ? byId.get(message.parent_id) : null;
    const relation = parent
      ? "Reply to " + escapeMarkdown(senderName(parent)) + " (" + new Date(parent.created_at).toISOString() + ")"
      : message.parent_id
        ? "Reply to an earlier message outside this snapshot"
        : "Message";
    const edited = message.edited_at && !message.retracted_at ? " · edited" : "";
    lines.push(
      "## " + relation + " — " + escapeMarkdown(senderName(message)),
      "",
      "_" + new Date(message.created_at).toISOString() + edited + "_",
      "",
      ...quotedBody(message),
      "",
    );
  }

  return lines.join("\n").trimEnd() + "\n";
}
