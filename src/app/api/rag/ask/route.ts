import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile } from "@/modules/auth/session";
import { retrievePassages } from "@/modules/rag/retrieve";
import { streamAnswer } from "@/modules/rag/answer";

/**
 * Ask-the-documents endpoint.
 *
 * Streams newline-delimited JSON rather than plain text so the answer, its
 * source list, and any error can share one connection without the client
 * guessing where each ends.
 *
 * Retrieval runs as the signed-in user, so `document_chunks`' RLS policy has
 * already removed anything they cannot read before generation sees it.
 */
export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let question = "";
  try {
    const body = (await request.json()) as { question?: unknown };
    question = String(body.question ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!question) {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }
  if (question.length > 2000) {
    return NextResponse.json({ error: "That question is too long." }, { status: 413 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        const { passages, degradedTo } = await retrievePassages(question);

        if (degradedTo === "keyword") {
          send({
            type: "notice",
            message:
              "Semantic search is unavailable, so this answer is based on keyword matches only.",
          });
        }

        for await (const event of streamAnswer(question, passages)) {
          send(event);
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
