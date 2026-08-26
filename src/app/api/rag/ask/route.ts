import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile } from "@/modules/auth/session";
import { retrievePassages } from "@/modules/rag/retrieve";
import { streamAnswer, type AnswerSource } from "@/modules/rag/answer";
import { buildHistoryWindow, resolveQuery } from "@/modules/memory/context";
import {
  loadWorkingMemory,
  maintainSummary,
  recordAnswer,
  recordQuestion,
  resumeOrCreateConversation,
} from "@/modules/memory/store";

/**
 * Ask-the-documents endpoint.
 *
 * Streams newline-delimited JSON rather than plain text so the answer, its
 * source list, and any error can share one connection without the client
 * guessing where each ends.
 *
 * Retrieval runs as the signed-in user, so `document_chunks`' RLS policy has
 * already removed anything they cannot read before generation sees it.
 *
 * The order of operations matters. Working memory is read *before* the new
 * question is stored, so the question never appears in its own context; the
 * question is then stored before generation begins, so a thread whose answer
 * fails still records what was asked.
 */
/**
 * One request here covers a follow-up rewrite, retrieval, and a generated
 * answer streamed a token at a time — comfortably past the short default a
 * serverless host applies when nothing says otherwise. Being cut off mid-stream
 * looks to the reader like the answer simply stopped, which is worse than a
 * clean failure. Sixty seconds is the Vercel Hobby maximum.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let question = "";
  let conversationId: string | null = null;
  try {
    const body = (await request.json()) as {
      question?: unknown;
      conversationId?: unknown;
    };
    question = String(body.question ?? "").trim();
    conversationId = body.conversationId ? String(body.conversationId) : null;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!question) {
    return NextResponse.json(
      { error: "Ask a question first." },
      { status: 400 },
    );
  }
  if (question.length > 2000) {
    return NextResponse.json(
      { error: "That question is too long." },
      { status: 413 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        const conversation = await resumeOrCreateConversation(
          profile.id,
          conversationId,
          question,
        );

        // Sent first so the client can put the thread in the URL immediately.
        // If the connection drops mid-answer, the person still has a link to a
        // thread that will contain the question when they come back to it.
        send({
          type: "conversation",
          id: conversation.id,
          title: conversation.title,
          isNew: conversation.message_count === 0,
        });

        const { turns, summary } = await loadWorkingMemory(conversation);
        const history = buildHistoryWindow(turns);

        // Retrieval is matched against the rewritten query, generation against
        // what was actually typed. "What about the fees?" retrieves nothing on
        // its own, but is what the person should see quoted back to them.
        const { query, rewritten } = await resolveQuery(question, history);

        await recordQuestion(
          conversation.id,
          question,
          rewritten ? query : null,
        );

        const { passages, degradedTo } = await retrievePassages(query);

        if (degradedTo === "keyword") {
          send({
            type: "notice",
            message:
              "Semantic search is unavailable, so this answer is based on keyword matches only.",
          });
        }

        let answer = "";
        let sources: AnswerSource[] = [];

        for await (const event of streamAnswer(question, passages, {
          history,
          summary,
        })) {
          if (event.type === "delta") answer += event.text;
          if (event.type === "sources") sources = event.sources;
          send(event);
        }

        if (answer.trim()) {
          await recordAnswer(conversation.id, answer, sources, {
            retrievalMode: degradedTo === "keyword" ? "keyword" : "hybrid",
            passageCount: passages.length,
          });

          // Housekeeping for the next question, after this one is fully sent.
          // The count is projected forward by the two turns just written rather
          // than re-read, since the trigger's value is only needed to decide
          // whether this thread has grown past the summary threshold.
          await maintainSummary({
            ...conversation,
            message_count: conversation.message_count + 2,
          });
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Stops intermediate proxies from buffering the whole answer before
      // forwarding a single byte of it.
      "x-accel-buffering": "no",
    },
  });
}
