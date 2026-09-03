import Link from "next/link";

import { requireProfile } from "@/modules/auth/session";
import { listVisibleDocuments, listVisibleTags } from "@/modules/documents/queries";
import { countUnresolvedComments } from "@/modules/comments/queries";
import { formatFileSize } from "@/modules/documents/constants";
import { searchDocumentContent } from "@/modules/search/queries";
import { Badge, EmptyState } from "@/components/ui";
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
    value.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalise(title) === normalise(fileName);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string; scope?: string }>;
}) {
  const [{ q, tag, scope }, profile] = await Promise.all([
    searchParams,
    requireProfile(),
  ]);

  const filtering = Boolean(q || tag || scope);

  const [documents, tags, contentMatches] = await Promise.all([
    listVisibleDocuments({
      query: q,
      tag,
      scope: scope === "mine" || scope === "shared" ? scope : undefined,
      viewerId: profile.id,
    }),
    listVisibleTags(),
    // Only worth the extra query when there is something to search for.
    q ? searchDocumentContent(q) : Promise.resolve([]),
  ]);

  /*
   * Folio numbers are assigned over the whole register, not over the current
   * view, so an entry keeps its number when a filter is applied. A number that
   * renumbered per filter would be a row counter wearing a ledger's clothes,
   * and the one thing a folio number means is that it does not move.
   *
   * It is still numbered within what this reader may see: the schema has no
   * document-wide sequence, and inventing a global one is a migration, not a
   * design decision.
   */
  const wholeRegister = filtering
    ? await listVisibleDocuments({ viewerId: profile.id })
    : documents;
  const folio = new Map(
    [...wholeRegister]
      .reverse()
      .map((doc, index) => [doc.id, String(index + 1).padStart(3, "0")]),
  );

  const listedIds = new Set(documents.map((doc) => doc.id));

  // One query for the whole page rather than one per row: a document waiting on
  // you should be visible without opening it, and twenty badges are not worth
  // twenty round trips.
  const unresolved = await countUnresolvedComments(documents.map((doc) => doc.id));
  const alsoFoundInside = contentMatches.filter(
    (match) => !listedIds.has(match.documentId),
  );

  const ownedCount = documents.filter((doc) => doc.owner_id === profile.id).length;
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
                ? "No entries match this filter."
                : "No entries yet."
              : `${documents.length} ${documents.length === 1 ? "entry" : "entries"} · ${ownedCount} yours · ${sharedCount} shared with you`}
          </p>
        </div>
        <UploadDocument userId={profile.id} />
      </div>

      <div className="mt-6">
        <DocumentFilters
          tags={tags}
          activeTag={tag}
          activeQuery={q}
          activeScope={scope}
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
          {/* The column heads of a ruled page. Hidden from a screen reader,
              which reads each row's own labels instead of a visual header it
              cannot associate with cells. */}
          <div
            aria-hidden="true"
            className="flex items-center gap-4 border-b border-rule/40 pb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-faint"
          >
            <span className="w-10 shrink-0">No.</span>
            <span className="min-w-0 flex-1">Entry</span>
            <span className="shrink-0">Recorded</span>
          </div>

          {/* Ruled stock, not rules drawn around content: the ruling runs at a
              fixed rhythm and each entry is written on one line of it, so the
              field reads as a page at one entry and at twenty alike. */}
          {/* The rhythm matches the entry height at every width, so an entry is
              always exactly one ruled line. A rhythm shorter than the row would
              put a rule through the middle of its own content, which is how the
              first attempt at this clipped the size line on a phone. */}
          <ul className="ledger-ruled flex-1 [--rule-rhythm:144px] sm:[--rule-rhythm:72px]">
            {documents.map((doc) => {
              const isOwner = doc.owner_id === profile.id;
              const ownerLabel =
                doc.owner?.full_name || doc.owner?.email || "Unknown owner";
              const openNotes = unresolved.get(doc.id);
              const showFileName = !isDerivedFromFileName(doc.title, doc.file_name);
              const detail = [
                showFileName ? doc.file_name : null,
                formatFileSize(doc.size_bytes),
                doc.tags.length > 0 ? doc.tags.join(", ") : null,
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <li key={doc.id}>
                  <Link
                    href={`/documents/${doc.id}`}
                    /* Two ruled lines on a narrow screen, one on a wide one:
                       the badges wrap below 640px and a single line would clip
                       them. Both heights are whole multiples of the rhythm, so
                       the ruling stays aligned at either size — which is also
                       how a real ledger takes a fuller entry. */
                    className="group -mx-2 flex h-[144px] items-center gap-4 overflow-hidden rounded-[2px] px-2 transition-colors hover:bg-brass/[0.09] sm:h-[72px]"
                  >
                    <span className="w-10 shrink-0 self-start pt-3 text-[13px] tabular-nums text-ink-faint">
                      {folio.get(doc.id)}
                    </span>

                    <span className="min-w-0 flex-1 self-start pt-2.5">
                      <span className="block truncate text-[15px] font-medium leading-tight tracking-[-0.01em] text-ink group-hover:text-cloth">
                        {doc.title}
                      </span>

                      <span className="mt-1.5 flex flex-wrap items-center gap-x-3 leading-none">
                        {isOwner ? (
                          <Badge tone="blue">Yours</Badge>
                        ) : (
                          <Badge tone="neutral">From {ownerLabel}</Badge>
                        )}
                        {doc.index_status === "indexed" ? (
                          <Badge tone="green">
                            Indexed
                            {doc.indexed_at ? ` ${shortDate(doc.indexed_at)}` : ""}
                          </Badge>
                        ) : null}
                        {openNotes ? (
                          <Badge tone="amber">
                            {openNotes} open {openNotes === 1 ? "note" : "notes"}
                          </Badge>
                        ) : null}
                      </span>

                      <span className="mt-1.5 block truncate text-xs leading-none text-ink-faint">
                        {detail}
                      </span>
                    </span>

                    <span className="shrink-0 self-start pt-3 text-xs tabular-nums text-ink-soft">
                      {formatDate(doc.created_at)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {alsoFoundInside.length > 0 ? (
        // A marginal note rather than a second register: same page, quieter
        // paper, indented off the main column so it reads as supplementary.
        <section className="mt-7 border-l border-rule-faint pl-4 sm:ml-10">
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
                  className="block rounded-[2px] px-2 py-2 transition-colors hover:bg-brass/[0.09]"
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
