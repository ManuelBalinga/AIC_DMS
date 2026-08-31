"use client";

import { useCallback, useState, useTransition } from "react";

import { Alert, Button, Card, Textarea } from "@/components/ui";
import { emptyActionState } from "@/lib/action-state";
import type { ChatReactionEmoji } from "@/lib/types/database";
import { editMessage, retractMessage, toggleReaction } from "@/modules/chat/actions";
import {
  buildMessageTree,
  displayName,
  type ChatPerson,
  type MessageWithSender,
} from "@/modules/chat/presentation";
import { MAX_MESSAGE_LENGTH } from "@/modules/chat/limits";

import { Composer } from "./composer";

const EMOJIS: ChatReactionEmoji[] = ["👍", "❤️", "🎉", "👀", "✅"];

function MessageBubble({
  message,
  threadId,
  currentUserId,
  canReply,
  interactive,
  onReply,
}: {
  message: MessageWithSender;
  threadId: string;
  currentUserId: string;
  canReply: boolean;
  interactive: boolean;
  onReply: (message: MessageWithSender) => void;
}) {
  const mine = message.sender_id === currentUserId;
  const retracted = Boolean(message.retracted_at);
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editState, setEditState] = useState(emptyActionState);
  const [editPending, startEditTransition] = useTransition();

  const editAction = (formData: FormData) => {
    startEditTransition(async () => {
      const result = await editMessage(emptyActionState, formData);
      setEditState(result);
      if (result.success) setEditing(false);
    });
  };

  const counts = new Map<ChatReactionEmoji, { count: number; mine: boolean }>();
  for (const reaction of message.reactions) {
    const current = counts.get(reaction.emoji) ?? { count: 0, mine: false };
    current.count += 1;
    current.mine ||= reaction.user_id === currentUserId;
    counts.set(reaction.emoji, current);
  }

  return (
    <div className={`max-w-[88%] ${mine ? "ml-auto" : "mr-auto"}`}>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {mine ? "You" : displayName(message.sender)}
        {" · "}
        <time dateTime={message.created_at}>
          {new Date(message.created_at).toLocaleString()}
        </time>
        {message.edited_at && !retracted ? " · edited" : ""}
      </p>

      {editing && !retracted ? (
        <form action={editAction} className="mt-1 space-y-2">
          <input type="hidden" name="message_id" value={message.id} />
          <input type="hidden" name="thread_id" value={threadId} />
          <Textarea
            name="body"
            defaultValue={message.body}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={3}
            required
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={editPending}>
              {editPending ? "Saving…" : "Save edit"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {editState.error ? <Alert tone="error">{editState.error}</Alert> : null}
        </form>
      ) : (
        <p
          className={`mt-1 whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
            retracted
              ? "border border-dashed border-neutral-300 italic text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
              : mine
                ? "bg-blue-600 text-white"
                : "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
          }`}
        >
          {retracted ? "Message retracted" : message.body}
        </p>
      )}

      {!retracted && message.mentions.length > 0 ? (
        <p className="mt-1 flex flex-wrap gap-1 text-xs text-blue-600 dark:text-blue-300">
          {message.mentions.map((mention) => (
            <span key={mention.mentioned_user_id} className="rounded bg-blue-50 px-1.5 py-0.5 dark:bg-blue-950/50">
              @{displayName(mention.profile)}
            </span>
          ))}
        </p>
      ) : null}

      {!retracted ? (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {EMOJIS.map((emoji) => {
            const reaction = counts.get(emoji);
            if (!interactive) {
              return reaction ? (
                <span key={emoji} className="rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  {emoji} {reaction.count}
                </span>
              ) : null;
            }
            return (
              <form key={emoji} action={toggleReaction}>
                <input type="hidden" name="thread_id" value={threadId} />
                <input type="hidden" name="message_id" value={message.id} />
                <input type="hidden" name="emoji" value={emoji} />
                <button
                  type="submit"
                  aria-label={`${reaction?.mine ? "Remove" : "Add"} ${emoji} reaction`}
                  className={`rounded-full border px-2 py-0.5 text-xs transition ${
                    reaction?.mine
                      ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50"
                      : "border-transparent text-neutral-500 hover:border-neutral-300 dark:text-neutral-400"
                  }`}
                >
                  {emoji}{reaction ? ` ${reaction.count}` : ""}
                </button>
              </form>
            );
          })}
          {interactive && canReply ? (
            <button
              type="button"
              onClick={() => onReply(message)}
              className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              Reply
            </button>
          ) : null}
          {interactive && mine ? (
            <>
              <button
                type="button"
                onClick={() => setEditing((value) => !value)}
                className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                Edit
              </button>
              <form
                action={retractMessage}
                onSubmit={(event) => {
                  if (!window.confirm("Retract this message? Its place in the conversation will remain.")) {
                    event.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="thread_id" value={threadId} />
                <input type="hidden" name="message_id" value={message.id} />
                <button type="submit" className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30">
                  Retract
                </button>
              </form>
            </>
          ) : null}
          {message.versions.length > 0 ? (
            <button
              type="button"
              onClick={() => setHistoryOpen((value) => !value)}
              className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              {historyOpen ? "Hide history" : `History (${message.versions.length})`}
            </button>
          ) : null}
        </div>
      ) : null}

      {historyOpen && !retracted ? (
        <ol className="mt-2 space-y-2 border-l-2 border-neutral-200 pl-3 text-xs dark:border-neutral-800">
          {[...message.versions]
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((version) => (
            <li key={version.id}>
              <time dateTime={version.created_at} className="text-neutral-400">
                {new Date(version.created_at).toLocaleString()}
              </time>
              <p className="whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">{version.body}</p>
            </li>
            ))}
        </ol>
      ) : null}
    </div>
  );
}

export function ConversationView({
  threadId,
  messages,
  participants,
  currentUserId,
  canParticipate,
}: {
  threadId: string;
  messages: MessageWithSender[];
  participants: ChatPerson[];
  currentUserId: string;
  canParticipate: boolean;
}) {
  const [replyTo, setReplyTo] = useState<{ id: string; label: string } | null>(null);
  const cancelReply = useCallback(() => setReplyTo(null), []);
  const tree = buildMessageTree(messages);
  const mentionablePeople = participants.filter((person) => person.id !== currentUserId);

  const beginReply = (message: MessageWithSender) => {
    setReplyTo({ id: message.id, label: displayName(message.sender) });
    document.getElementById("message-composer")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <>
      <Card>
        {tree.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            No messages yet. Say something.
          </p>
        ) : (
          <ol className="space-y-5">
            {tree.map((message) => (
              <li key={message.id}>
                <MessageBubble
                  message={message}
                  threadId={threadId}
                  currentUserId={currentUserId}
                  canReply
                  interactive={canParticipate}
                  onReply={beginReply}
                />
                {message.replies.length > 0 ? (
                  <ol className="ml-6 mt-3 space-y-3 border-l-2 border-neutral-200 pl-4 dark:border-neutral-800">
                    {message.replies.map((reply) => (
                      <li key={reply.id}>
                        <MessageBubble
                          message={reply}
                          threadId={threadId}
                          currentUserId={currentUserId}
                          canReply={false}
                          interactive={canParticipate}
                          onReply={beginReply}
                        />
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {canParticipate ? (
        <div id="message-composer">
          <Composer
            threadId={threadId}
            people={mentionablePeople}
            replyTo={replyTo}
            onCancelReply={cancelReply}
          />
        </div>
      ) : (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Join this open team to write, reply, mention colleagues or react.</p>
      )}
    </>
  );
}
