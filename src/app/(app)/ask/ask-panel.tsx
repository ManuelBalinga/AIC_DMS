"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Alert, Badge, Button, Card, Textarea } from "@/components/ui";

export type Source = {
  number: number;
  /** Null once the cited document has been deleted — the citation still reads. */
  documentId: string | null;
  documentTitle: string;
  pageNumber: number | null;
  excerpt: string;
};

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
};

type StreamEvent =
  | { type: "conversation"; id: string; title: string; isNew: boolean }
  | { type: "sources"; sources: Source[] }
  | { type: "delta"; text: string }
  | { type: "notice"; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

const EXAMPLES = [
  "What does the i363 material say about eligibility?",
  "Summarise the latest product update.",
  "Which documents mention the training schedule?",
];

/**
 * Renders an answer, turning `[n]` citations into links to the source document.
 *
 * Splitting on the bracket pattern rather than parsing markdown keeps this
 * honest: the only thing being interpreted is the citation convention the
 * system prompt asks for.
 */
function AnswerBody({ text, sources }: { text: string; sources: Source[] }) {
  const byNumber = new Map(sources.map((source) => [source.number, source]));
  const pieces = text.split(/(\[\d+(?:,\s*\d+)*\])/g);

  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
      {pieces.map((piece, index) => {
        const citation = piece.match(/^\[(\d+(?:,\s*\d+)*)\]$/);
        if (!citation) return <span key={index}>{piece}</span>;

        const numbers = citation[1].split(/,\s*/).map(Number);

        return (
          <span key={index}>
            {numbers.map((number, position) => {
              const source = byNumber.get(number);
              const separator = position > 0 ? " " : "";

              if (!source?.documentId) {
                return <span key={number}>{separator}[{number}]</span>;
              }

              return (
                <span key={number}>
                  {separator}
                  <Link
                    href={`/documents/${source.documentId}`}
                    title={`${source.documentTitle}${
                      source.pageNumber ? `, page ${source.pageNumber}` : ""
                    }`}
                    className="mx-0.5 rounded bg-blue-100 px-1 text-xs font-medium text-blue-800 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
                  >
                    {number}
                  </Link>
                </span>
              );
            })}
          </span>
        );
      })}
    </p>
  );
}

function SourceList({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-5 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
        Sources
      </p>
      <ul className="mt-2 space-y-2">
        {sources.map((source) => (
          <li key={source.number} className="flex gap-2 text-sm">
            <Badge tone="blue">{source.number}</Badge>
            <div className="min-w-0">
              {source.documentId ? (
                <Link
                  href={`/documents/${source.documentId}`}
                  className="font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                >
                  {source.documentTitle}
                </Link>
              ) : (
                <span
                  className="font-medium text-neutral-500 dark:text-neutral-400"
                  title="This document has since been deleted."
                >
                  {source.documentTitle} (deleted)
                </span>
              )}
              {source.pageNumber ? (
                <span className="text-neutral-500 dark:text-neutral-400">
                  {" "}
                  · page {source.pageNumber}
                </span>
              ) : null}
              <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                {source.excerpt}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Ask thread.
 *
 * Every turn is already on the server by the time it renders here, so this
 * component holds no memory of its own — the messages in state are a mirror of
 * the thread, kept locally only so an answer can stream in before the page
 * revalidates. Reloading mid-thread loses nothing.
 */
export function AskPanel({
  conversationId,
  initialMessages,
}: {
  conversationId: string | null;
  initialMessages: ThreadMessage[];
}) {
  const router = useRouter();

  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [threadId, setThreadId] = useState<string | null>(conversationId);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState<{ text: string; sources: Source[] } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streaming?.text]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPending(true);
    setNotice(null);
    setError(null);
    setQuestion("");
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: "user", content: trimmed, sources: [] },
    ]);
    setStreaming({ text: "", sources: [] });

    let answer = "";
    let sources: Source[] = [];

    try {
      const response = await fetch("/api/rag/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed, conversationId: threadId }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "The request failed.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // The final line of a chunk is usually a partial JSON object, so it is
        // held back until the newline that completes it arrives.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }

          switch (event.type) {
            case "conversation":
              setThreadId(event.id);
              // replaceState rather than a router navigation: the thread is
              // already on screen, and navigating would tear down the stream
              // that is still filling it in. This only makes the URL shareable
              // and reload-safe from the first token onwards.
              if (event.isNew) {
                window.history.replaceState(null, "", `/ask?c=${event.id}`);
              }
              break;
            case "sources":
              sources = event.sources;
              setStreaming((current) =>
                current ? { ...current, sources: event.sources } : current,
              );
              break;
            case "delta":
              answer += event.text;
              setStreaming((current) =>
                current ? { ...current, text: current.text + event.text } : current,
              );
              break;
            case "notice":
              setNotice(event.message);
              break;
            case "error":
              setError(event.message);
              break;
          }
        }
      }
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") {
        setError("The connection dropped before the answer finished.");
      }
    } finally {
      if (answer.trim()) {
        setMessages((current) => [
          ...current,
          {
            id: `local-answer-${Date.now()}`,
            role: "assistant",
            content: answer,
            sources,
          },
        ]);
      }
      setStreaming(null);
      setPending(false);

      // Brings the sidebar up to date with the thread that was just created or
      // touched. Server state is the source of truth; the local mirror above
      // only existed to avoid waiting for this round trip.
      router.refresh();
    }
  }

  const empty = messages.length === 0 && !streaming;

  return (
    <div className="space-y-6">
      {messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
              {message.content}
            </p>
          </div>
        ) : (
          <Card key={message.id} className="p-5">
            <AnswerBody text={message.content} sources={message.sources} />
            <SourceList sources={message.sources} />
          </Card>
        ),
      )}

      {streaming ? (
        <Card className="p-5">
          {streaming.text ? (
            <AnswerBody text={streaming.text} sources={streaming.sources} />
          ) : (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">
              Searching the documents you can access…
            </p>
          )}
          <SourceList sources={streaming.sources} />
        </Card>
      ) : null}

      {notice ? <Alert tone="error">{notice}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div ref={endRef} />

      <Card className="p-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
          className="space-y-3"
        >
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a newline. Questions are usually one
              // line, so making the common case the fast one.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(question);
              }
            }}
            rows={3}
            required
            placeholder={
              empty
                ? "Ask anything about the documents you can access…"
                : "Ask a follow-up…"
            }
          />

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {empty
                ? "Answers only use documents shared with you."
                : "Follow-ups keep the context of this conversation."}
            </p>
            <Button type="submit" disabled={pending || !question.trim()}>
              {pending ? "Thinking..." : "Ask"}
            </Button>
          </div>
        </form>
      </Card>

      {empty ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Try one of these
          </p>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => void ask(example)}
              className="block w-full rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
