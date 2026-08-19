import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  INTELLIGENCE_MODEL,
  MAX_SUGGESTED_TAGS,
  SUMMARY_INPUT_MAX_CHARS,
  SUMMARY_MAX_CHARS,
  SUMMARY_MAX_TOKENS,
  TAGGING_INPUT_MAX_CHARS,
  TAGGING_MAX_TOKENS,
} from "@/modules/intelligence/config";
import { MAX_TAG_LENGTH } from "@/modules/documents/constants";

/**
 * Document summarisation and tag suggestion (master plan Phase 4).
 *
 * Both run from ingestion, on text that has already been extracted — so
 * neither re-reads the stored file, and neither is on the path of a person
 * waiting for an answer.
 *
 * Every function here returns null rather than throwing. These are enrichments:
 * a document with no summary is a document that still uploads, stores, shares
 * and answers questions. Letting a summariser failure fail an upload would
 * trade a core guarantee for a nicety.
 */

function configured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function complete(
  system: string,
  user: string,
  maxTokens: number,
): Promise<string | null> {
  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: INTELLIGENCE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    return text || null;
  } catch {
    return null;
  }
}

const SUMMARY_SYSTEM = `You summarise internal company documents for the Accra Innovation Center.

Write three to four sentences covering what the document is, who it concerns, and what it establishes or asks for. Lead with what it is — "A fee schedule for..." — so someone scanning a list of documents can tell them apart.

Keep names, dates, figures and identifiers exactly as written; they are what people search for later.

Write only the summary. No preamble, no "This document...", no bullet points.

If the text is too fragmentary to summarise, say only: INSUFFICIENT`;

/**
 * A short description of what a document is.
 *
 * Reads the opening rather than the whole file — see `SUMMARY_INPUT_MAX_CHARS`
 * for why. The model is told to answer INSUFFICIENT rather than invent a
 * summary from noise, which is the common failure on a scanned page that
 * produced three words of text.
 */
export async function summariseDocument(
  title: string,
  text: string,
): Promise<string | null> {
  if (!configured()) return null;

  const excerpt = text.slice(0, SUMMARY_INPUT_MAX_CHARS).trim();
  if (excerpt.length < 200) return null;

  const summary = await complete(
    SUMMARY_SYSTEM,
    `Document title: ${title}\n\nDocument text:\n\n${excerpt}`,
    SUMMARY_MAX_TOKENS,
  );

  if (!summary || summary.startsWith("INSUFFICIENT")) return null;

  return summary.length > SUMMARY_MAX_CHARS
    ? `${summary.slice(0, SUMMARY_MAX_CHARS).trimEnd()}…`
    : summary;
}

const TAGGING_SYSTEM = `You propose filing tags for internal company documents at the Accra Innovation Center.

Reply with a comma-separated list of at most ${MAX_SUGGESTED_TAGS} short tags, lower case, one or two words each. Nothing else.

Good tags name what the document is and what it concerns — "fee schedule", "i363", "training", "product update", "policy". Prefer terms that would group this document with others like it.

Avoid tags true of every document ("document", "aic", "internal", "pdf"), and avoid inventing a category for a single file.

If nothing useful can be said, reply with nothing at all.`;

/**
 * Tags a document might be filed under.
 *
 * Returned as *suggestions*, stored separately from the tags a person chose.
 * The model never edits someone's filing — a suggestion is a proposal until a
 * human accepts it, and `suggested_tags` exists to keep that distinction real
 * rather than a matter of intent.
 */
export async function suggestTags(
  title: string,
  text: string,
  existingTags: string[] = [],
): Promise<string[]> {
  if (!configured()) return [];

  const excerpt = text.slice(0, TAGGING_INPUT_MAX_CHARS).trim();
  if (excerpt.length < 100) return [];

  const raw = await complete(
    TAGGING_SYSTEM,
    `Document title: ${title}\n\nDocument text:\n\n${excerpt}`,
    TAGGING_MAX_TOKENS,
  );

  if (!raw) return [];

  return normaliseSuggestedTags(raw, existingTags);
}

/**
 * Cleans a model's tag list into something the tag column will accept.
 *
 * Exported for its own sake: this is where a model's output meets a database
 * constraint, and it is far easier to test directly than through a network
 * call. Applies the same rules as `parseTags` so a suggestion accepted by a
 * person is identical to one they typed.
 */
export function normaliseSuggestedTags(
  raw: string,
  existingTags: string[] = [],
): string[] {
  const already = new Set(existingTags.map((tag) => tag.toLowerCase()));
  const seen = new Set<string>();

  for (const piece of raw.split(/[,\n]/)) {
    const tag = piece
      .trim()
      .toLowerCase()
      // Models like to number or bullet a list even when told not to.
      .replace(/^[-*\d.)\s]+/, "")
      .replace(/["'`]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, MAX_TAG_LENGTH)
      .trim();

    if (!tag) continue;
    if (already.has(tag)) continue;

    seen.add(tag);
    if (seen.size >= MAX_SUGGESTED_TAGS) break;
  }

  return [...seen];
}
