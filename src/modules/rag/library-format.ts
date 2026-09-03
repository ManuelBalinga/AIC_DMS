/**
 * The shape of the catalogue, and how it reads to the model.
 *
 * Split from `library.ts` because that module reaches the database through the
 * Supabase server client, which pulls in `next/headers` and cannot load outside
 * a request. Everything here is a pure function of its arguments, so the part
 * with the failure modes worth testing is the part that can actually be tested.
 * The same split the preview predicate needed, for the same reason.
 */

export type LibraryDocument = {
  title: string;
  fileName: string;
  tags: string[];
  summary: string | null;
  uploadedAt: string;
  indexed: boolean;
};

export type Library = {
  total: number;
  indexed: number;
  awaitingIndex: number;
  /** Capped by the query; `truncated` says whether anything was left out. */
  documents: LibraryDocument[];
  truncated: boolean;
};

/**
 * The catalogue as the model reads it.
 *
 * Numbered, but deliberately not with the `[n]` used for passages: those
 * numbers are citations the interface turns into links to a specific page, and
 * a catalogue entry is not a citation — there is no page to open. Bracketing
 * anything here produces a footnote that looks clickable and is not, because
 * `ask-panel.tsx` only matches digits inside brackets.
 */
export function formatLibrary(library: Library): string {
  if (library.total === 0) {
    return "LIBRARY: you can currently see no documents at all.";
  }

  const header =
    `LIBRARY: ${library.total} document${library.total === 1 ? "" : "s"} you are allowed to see` +
    (library.awaitingIndex > 0
      ? ` — ${library.indexed} indexed and searchable, ${library.awaitingIndex} still being processed and not yet quotable.`
      : ` — all indexed and searchable.`) +
    (library.truncated
      ? ` This list is capped, so there are more than are named here; do not state a total.`
      : ` This list is complete, so it is safe to count.`);

  const lines = library.documents.map((doc, index) => {
    const date = new Date(doc.uploadedAt).toISOString().slice(0, 10);
    const parts = [
      `${index + 1}. "${doc.title}" (${doc.fileName})`,
      `uploaded ${date}`,
      doc.tags.length ? `tags: ${doc.tags.join(", ")}` : null,
      doc.indexed ? null : "not yet indexed",
    ].filter(Boolean);
    const head = parts.join(" · ");
    return doc.summary ? `${head}\n   ${doc.summary}` : head;
  });

  return `${header}\n\n${lines.join("\n")}`;
}
