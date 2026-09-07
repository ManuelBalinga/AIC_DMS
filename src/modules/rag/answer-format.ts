/**
 * Turning an answer into something readable, whatever the model emitted.
 *
 * The renderer splits on the citation pattern and renders everything else as
 * literal text, which is the honest choice — the only convention it interprets
 * is the one the system prompt actually asks for. The cost is that a model
 * reaching for markdown out of habit puts raw syntax on the page: asterisks
 * around a phrase it wanted to emphasise, a run of `* ` where it wanted a list,
 * a stray `###`. None of it means anything here, and all of it looks like the
 * machinery showing through.
 *
 * The prompt now asks for plain prose, which helps and is not sufficient — an
 * instruction not to use markdown is one a model follows most of the time, and
 * "most of the time" is visible to every reader who hits the exception. So the
 * residue is cleaned here as well. Belt and braces, with the braces being the
 * half that does not depend on the model cooperating.
 *
 * Stripping rather than rendering. The user's complaint was that the markers
 * are noise, not that the emphasis was unavailable, and a document platform
 * whose answers quietly bold half a sentence is making an editorial claim the
 * passages did not authorise. Lists are the exception: a model that wanted a
 * list produces something genuinely unreadable as a run-on paragraph, so those
 * become a real list and the markers go.
 */

export type AnswerBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

/** Matches a line that was meant as a bullet: `*`, `-`, `+`, `•`, or `1.`. */
const BULLET = /^\s{0,3}(?:[*+\-•]|\d{1,2}[.)])\s+(.*)$/;

/**
 * Removes inline markdown while leaving the words, and leaving citations alone.
 *
 * Citations are `[1]` or `[1, 2]` and no rule here touches square brackets, so
 * the renderer's own splitting still finds them afterwards. Order matters: the
 * two-character fences go before the one-character ones, or `**text**` loses
 * its inner pair first and leaves orphans behind.
 */
export function stripInlineMarkdown(text: string): string {
  return (
    text
      // Headings, which have no meaning in a single answer bubble.
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      // Blockquote markers.
      .replace(/^\s{0,3}>\s?/gm, "")
      // Bold, italic, strikethrough, code. Two-character fences first.
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, "$1$2")
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, "$1$2")
      .replace(/`([^`\n]+)`/g, "$1")
      // A horizontal rule on its own line.
      .replace(/^\s{0,3}(?:[-*_]\s?){3,}\s*$/gm, "")
  );
}

/**
 * Splits an answer into paragraphs and lists.
 *
 * Blank lines separate blocks, and a run of bullet lines becomes one list
 * rather than several one-item lists — the latter is what a naive line-by-line
 * pass produces, and it renders as a column of lonely dots.
 */
export function toBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const joined = stripInlineMarkdown(paragraph.join("\n")).trim();
    if (joined) blocks.push({ kind: "paragraph", text: joined });
    paragraph = [];
  };

  const flushList = () => {
    if (items.length === 0) return;
    const cleaned = items
      .map((item) => stripInlineMarkdown(item).trim())
      .filter(Boolean);
    if (cleaned.length > 0) blocks.push({ kind: "list", items: cleaned });
    items = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const bullet = line.match(BULLET);

    if (bullet) {
      flushParagraph();
      items.push(bullet[1]);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    // A non-bullet line ends a list. Continuation lines indented under a bullet
    // are rare enough from this model that treating them as a new paragraph is
    // the lesser wrong compared with silently swallowing them into the last
    // item.
    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}
