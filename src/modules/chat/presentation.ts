import type {
  ChatMessage,
  ChatMessageVersion,
  ChatReaction,
  ChatDocumentReferenceProjection,
  Profile,
} from "@/lib/types/database";

export type ChatPerson = Pick<Profile, "id" | "full_name" | "email">;

export type MessageWithSender = ChatMessage & {
  sender: ChatPerson | null;
  mentions: { mentioned_user_id: string; profile: ChatPerson | null }[];
  reactions: Pick<ChatReaction, "user_id" | "emoji">[];
  versions: Pick<ChatMessageVersion, "id" | "body" | "created_at">[];
  document_references: ChatDocumentReferenceProjection[];
};

export type ThreadedMessage = MessageWithSender & { replies: MessageWithSender[] };

export function displayName(person: ChatPerson | null): string {
  if (!person) return "A former colleague";
  return person.full_name?.trim() || person.email;
}

/** Groups the flat database result without hiding orphaned rows. */
export function buildMessageTree(messages: MessageWithSender[]): ThreadedMessage[] {
  const visibleIds = new Set(messages.map((message) => message.id));
  const replies = new Map<string, MessageWithSender[]>();
  for (const message of messages) {
    if (!message.parent_id) continue;
    const list = replies.get(message.parent_id) ?? [];
    list.push(message);
    replies.set(message.parent_id, list);
  }

  return messages
    .filter((message) => !message.parent_id || !visibleIds.has(message.parent_id))
    .map((message) => ({ ...message, replies: replies.get(message.id) ?? [] }));
}
