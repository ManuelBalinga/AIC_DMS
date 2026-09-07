import Link from "next/link";

import type { DocumentWithOwner } from "@/modules/documents/queries";

import { CardPreview } from "./card-preview";

/** Three-letter mark for a file's kind, from its MIME type. */
function kindOf(mimeType: string, fileName: string): string {
  const byMime: Record<string, string> = {
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "DOC",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLS",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "PPT",
    "application/vnd.ms-powerpoint": "PPT",
    "text/csv": "CSV",
    "text/markdown": "MD",
    "text/plain": "TXT",
  };
  if (byMime[mimeType]) return byMime[mimeType];
  if (mimeType.startsWith("image/")) return "IMG";
  const ext = fileName.split(".").pop();
  return ext ? ext.slice(0, 4).toUpperCase() : "FILE";
}

/**
 * Weight, not colour, separates one kind from another.
 *
 * The three treatments are a filled mark, a hatched one and an outline. That is
 * a deliberately small vocabulary: the mark exists so a reader can tell one
 * document from its neighbour at a glance, and eleven distinguishable fills
 * would be eleven things to learn rather than one thing to notice.
 */
function fillFor(kind: string): string {
  if (kind === "PDF") return "bg-accent text-accent-ink border-accent";
  if (kind === "XLS" || kind === "CSV")
    // A ruled grid, which is what a spreadsheet is, drawn at a weight that
    // leaves the three letters on top of it legible. The first attempt hatched
    // the whole tile and the letters disappeared into it.
    return "border-control text-ink [background:repeating-linear-gradient(0deg,transparent_0_5px,var(--color-line)_5px_6px),repeating-linear-gradient(90deg,transparent_0_5px,var(--color-line)_5px_6px)]";
  return "border-control text-ink-soft";
}

/**
 * Initials for the avatar. Always the owner's own, never a word like "You" —
 * an avatar showing "YO" is a bug that reads as a name.
 */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function relativeDay(value: string): string {
  const then = new Date(value);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

export function DocumentCard({
  document: doc,
  isOwner,
  preview,
  openNotes,
}: {
  document: DocumentWithOwner;
  isOwner: boolean;
  /** The document's own opening words, when it has been indexed. */
  preview?: string;
  openNotes?: number;
}) {
  const kind = kindOf(doc.mime_type, doc.file_name);
  const ownerName =
    doc.owner?.full_name || doc.owner?.email || "a former colleague";

  /*
   * What fills the card's window, in order of how much it tells you.
   *
   * CardPreview decides between the file's own face — the first page of the
   * real document, per format — and its words. When neither exists the card
   * says *why*, because "no preview" and "this has not been indexed yet" are
   * different facts and the second one is actionable.
   */
  const body =
    doc.summary?.trim() || preview || doc.description?.trim() || null;

  const status =
    doc.index_status === "indexed"
      ? "No text to show"
      : doc.index_status === "failed"
        ? "Could not be read"
        : "Still being read…";

  return (
    <Link
      href={`/documents/${doc.id}`}
      className="group flex flex-col overflow-hidden rounded-sheet border border-line bg-surface transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-control hover:shadow-[0_6px_20px_-8px_rgba(0,0,0,0.18)]"
    >
      <div className="relative h-[132px] overflow-hidden border-b border-line bg-surface-sunk px-4 pt-3.5">
        <CardPreview
          documentId={doc.id}
          mimeType={doc.mime_type}
          body={body}
          status={status}
        />

        <span
          className={`absolute bottom-3 right-3 grid size-9 place-items-center rounded-[5px] border text-[8.5px] font-bold tracking-[0.04em] ${fillFor(kind)}`}
          aria-hidden="true"
        >
          {kind}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 px-4 py-3.5">
        <p className="line-clamp-2 text-[14.5px] font-medium leading-snug tracking-[-0.01em] text-ink">
          {doc.title}
        </p>

        <div className="mt-auto flex items-center gap-2 text-xs text-ink-soft">
          <span
            aria-hidden="true"
            className="grid size-[22px] shrink-0 place-items-center rounded-full border border-line bg-surface-sunk text-[9.5px] font-bold text-ink-soft"
          >
            {initialsOf(ownerName)}
          </span>
          <span className="truncate">
            {isOwner ? "You" : ownerName}, {relativeDay(doc.created_at)}
          </span>
          {openNotes ? (
            <span className="ml-auto shrink-0 rounded-full border border-control px-2 py-0.5 text-[11.5px] text-ink">
              {openNotes} {openNotes === 1 ? "note" : "notes"}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
