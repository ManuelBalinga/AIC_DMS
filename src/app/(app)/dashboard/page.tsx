import Link from "next/link";

import { requireProfile } from "@/modules/auth/session";
import {
  listDocumentPreviews,
  listVisibleDocuments,
} from "@/modules/documents/queries";
import { countUnresolvedComments } from "@/modules/comments/queries";
import { formatFileSize } from "@/modules/documents/constants";
import { searchDocumentContent } from "@/modules/search/queries";
import { Badge, Chevron, EmptyState } from "@/components/ui";
import { DocumentCard } from "./document-card";
import { DocumentFilters } from "./document-filters";
import { UploadDocument } from "./upload-document";

export const metadata = { title: "Documents | AIC Documents" };

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

/**
 * A file name and the title derived from it are the same fact twice. Printing
 * both spends an entry's two most legible lines on one unreadable string.
 */
function isDerivedFromFileName(title: string, fileName: string) {
  const normalise = (value: string) =>
    value
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
  return normalise(title) === normalise(fileName);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    tag?: string;
    scope?: string;
    view?: string;
  }>;
}) {
  const [{ q, tag, scope, view }, profile] = await Promise.all([
    searchParams,
    requireProfile(),
  ]);

  const filtering = Boolean(q || tag || scope);

  // Tags are not fetched here: the rail already queries them for the whole
  // shell, and asking twice on the same render is one query for one answer.
  const [documents, contentMatches] = await Promise.all([
    listVisibleDocuments({
      query: q,
      tag,
      scope: scope === "mine" || scope === "shared" ? scope : undefined,
      viewerId: profile.id,
    }),
    // Only worth the extra query when there is something to search for.
    q ? searchDocumentContent(q) : Promise.resolve([]),
  ]);

  const listedIds = new Set(documents.map((doc) => doc.id));

  // One query for the whole page rather than one per row: a document waiting on
  // you should be visible without opening it, and twenty badges are not worth
  // twenty round trips.
  const documentIds = documents.map((doc) => doc.id);
  const [unresolved, previews] = await Promise.all([
    countUnresolvedComments(documentIds),
    // Only the grid draws a document's opening text, so the list view does not
    // pay for a query it will not render.
    view === "list"
      ? Promise.resolve(new Map<string, string>())
      : listDocumentPreviews(documentIds),
  ]);
  const alsoFoundInside = contentMatches.filter(
    (match) => !listedIds.has(match.documentId),
  );

  const ownedCount = documents.filter(
    (doc) => doc.owner_id === profile.id,
  ).length;
  const sharedCount = documents.length - ownedCount;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[27px] font-semibold leading-none tracking-[-0.02em] text-ink">
            Documents
          </h1>
          <p className="mt-2.5 text-sm text-ink-soft">
            {documents.length === 0
              ? filtering
                ? "Nothing matches this filter."
                : "No documents yet."
              : `${documents.length} ${documents.length === 1 ? "document" : "documents"}, ${ownedCount} yours and ${sharedCount} shared with you`}
          </p>
        </div>
        <UploadDocument userId={profile.id} />
      </div>

      <div className="mt-6">
        <DocumentFilters
          activeQuery={q}
          activeScope={scope}
          activeView={view}
        />
      </div>

      {documents.length === 0 ? (
        <div className="mt-6 flex-1">
          {filtering ? (
            <EmptyState
              title="No documents match those filters"
              description="Try a broader search, clear the tag, or switch back to All — the scope filter narrows this list too."
            />
          ) : (
            <EmptyState
              title="No documents yet"
              description="Upload the first company document to move it off WhatsApp and into the platform."
            />
          )}
        </div>
      ) : (
        <div className="mt-6 flex flex-1 flex-col">
          {view === "list" ? (
            <>
              {/* Column heads. Hidden from a screen reader, which reads each
                  row's own labels instead of a visual header it cannot
                  associate with cells. */}
              <div
                aria-hidden="true"
                className="flex items-center gap-4 border-b border-line-strong pb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-faint"
              >
                <span className="min-w-0 flex-1">Entry</span>
                <span className="shrink-0">Recorded</span>
              </div>

              <ul>
                {documents.map((doc) => {
                  const isOwner = doc.owner_id === profile.id;
                  const ownerLabel =
                    doc.owner?.full_name || doc.owner?.email || "Unknown owner";
                  const openNotes = unresolved.get(doc.id);
                  const showFileName = !isDerivedFromFileName(
                    doc.title,
                    doc.file_name,
                  );
                  const detail = [
                    showFileName ? doc.file_name : null,
                    formatFileSize(doc.size_bytes),
                    doc.tags.length > 0 ? doc.tags.join(", ") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <li key={doc.id} className="row">
                      <Link
                        href={`/documents/${doc.id}`}
                        className="group -mx-2 flex items-start gap-4 rounded-control px-2 py-3.5 transition-colors hover:bg-surface-sunk"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="min-w-0 truncate text-[15px] font-medium leading-snug tracking-[-0.01em] text-ink">
                              {doc.title}
                            </span>
                            <Chevron className="reveal text-ink-faint" />
                          </span>

                          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 leading-none">
                            {isOwner ? (
                              <Badge tone="blue">Yours</Badge>
                            ) : (
                              <Badge tone="neutral">From {ownerLabel}</Badge>
                            )}
                            {doc.index_status === "indexed" ? (
                              <Badge tone="green">
                                Indexed
                                {doc.indexed_at
                                  ? ` ${shortDate(doc.indexed_at)}`
                                  : ""}
                              </Badge>
                            ) : null}
                            {openNotes ? (
                              <Badge tone="amber">
                                {openNotes} open{" "}
                                {openNotes === 1 ? "note" : "notes"}
                              </Badge>
                            ) : null}
                          </span>

                          {detail ? (
                            <span className="mt-2 block truncate text-xs leading-none text-ink-faint">
                              {detail}
                            </span>
                          ) : null}
                        </span>

                        <span className="shrink-0 pt-0.5 text-xs tabular-nums text-ink-soft">
                          {formatDate(doc.created_at)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            /* The shelf. Four across on a wide screen, which is the widest a
               card can be before its opening text stops being a paragraph and
               starts being a line. */
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {documents.map((doc) => (
                <li key={doc.id} className="flex">
                  <div className="flex w-full">
                    <DocumentCard
                      document={doc}
                      isOwner={doc.owner_id === profile.id}
                      preview={previews.get(doc.id)}
                      openNotes={unresolved.get(doc.id)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {alsoFoundInside.length > 0 ? (
        // A marginal note rather than a second register: same page, quieter
        // paper, indented off the main column so it reads as supplementary.
        <section className="mt-8 border-l border-line pl-4 sm:ml-10">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-soft">
            Also mentioned inside
          </h2>
          <p className="mt-1 max-w-[62ch] text-xs leading-relaxed text-ink-faint">
            These documents do not match on title or tags, but their contents
            mention it.
          </p>
          <ul className="mt-3 space-y-px">
            {alsoFoundInside.map((match) => (
              <li key={match.documentId}>
                <Link
                  href={`/documents/${match.documentId}`}
                  className="block rounded-control px-2 py-2 transition-colors hover:bg-surface-sunk"
                >
                  <p className="text-sm font-medium text-ink">
                    {match.documentTitle}
                    {match.pageNumber ? (
                      <span className="ml-2 text-xs font-normal tabular-nums text-ink-faint">
                        page {match.pageNumber}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                    {match.snippet}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
