"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { Alert, Badge, Button, Card, Textarea } from "@/components/ui";

type Source = {
  number: number;
  documentId: string;
  documentTitle: string;
  pageNumber: number | null;
  excerpt: string;
};

type StreamEvent =
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

              if (!source) return <span key={number}>{separator}[{number}]</span>;

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

export function AskPanel() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPending(true);
    setAnswer("");
    setSources([]);
    setNotice(null);
    setError(null);
    setAsked(trimmed);

    try {
      const response = await fetch("/api/rag/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
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
            case "sources":
              setSources(event.sources);
              break;
            case "delta":
              setAnswer((current) => current + event.text);
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
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
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
            placeholder="Ask anything about the documents you can access…"
          />

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Answers only use documents shared with you.
            </p>
            <Button type="submit" disabled={pending || !question.trim()}>
              {pending ? "Thinking..." : "Ask"}
            </Button>
          </div>
        </form>
      </Card>

      {!asked ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Try one of these
          </p>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setQuestion(example);
                void ask(example);
              }}
              className="block w-full rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {notice ? <Alert tone="error">{notice}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {asked && (answer || pending) ? (
        <Card className="p-5">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {asked}
          </p>

          <div className="mt-3">
            {answer ? (
              <AnswerBody text={answer} sources={sources} />
            ) : (
              <p className="text-sm text-neutral-400 dark:text-neutral-500">
                Searching the documents you can access…
              </p>
            )}
          </div>

          {sources.length > 0 ? (
            <div className="mt-5 border-t border-neutral-200 pt-4 dark:border-neutral-800">
              <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Sources
              </p>
              <ul className="mt-2 space-y-2">
                {sources.map((source) => (
                  <li key={source.number} className="flex gap-2 text-sm">
                    <Badge tone="blue">{source.number}</Badge>
                    <div className="min-w-0">
                      <Link
                        href={`/documents/${source.documentId}`}
                        className="font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                      >
                        {source.documentTitle}
                      </Link>
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
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
