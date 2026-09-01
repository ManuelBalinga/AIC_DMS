import Link from "next/link";

import { requireProfile } from "@/modules/auth/session";
import { listVisibleDocuments, listVisibleTags } from "@/modules/documents/queries";
import { countUnresolvedComments } from "@/modules/comments/queries";
import { formatFileSize } from "@/modules/documents/constants";
import { searchDocumentContent } from "@/modules/search/queries";
import { Badge, Card, EmptyState } from "@/components/ui";
import { DocumentFilters } from "./document-filters";
import { UploadDocument } from "./upload-document";

export const metadata = { title: "Documents | AIC Documents" };

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Documents
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {documents.length === 0
              ? filtering
                ? "No matches."
                : "Nothing here yet."
              : `${ownedCount} yours · ${sharedCount} shared with you`}
          </p>
        </div>
        <UploadDocument userId={profile.id} />
      </div>

      <DocumentFilters
        tags={tags}
        activeTag={tag}
        activeQuery={q}
        activeScope={scope}
      />

      {documents.length === 0 ? (
        filtering ? (
          <EmptyState
            title="No documents match those filters"
            description="Try a broader search, or clear the tag filter."
          />
        ) : (
          <EmptyState
            title="No documents yet"
            description="Upload the first company document to move it off WhatsApp and into the platform."
          />
        )
      ) : (
        <Card>
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {documents.map((doc) => {
              const isOwner = doc.owner_id === profile.id;
              const ownerLabel =
                doc.owner?.full_name || doc.owner?.email || "Unknown owner";

              return (
                <li key={doc.id}>
                  <Link
                    href={`/documents/${doc.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                          {doc.title}
                        </p>
                        {isOwner ? (
                          <Badge tone="blue">Owner</Badge>
                        ) : (
                          <Badge tone="neutral">Shared</Badge>
                        )}
                        {doc.index_status === "indexed" ? (
                          <Badge tone="green">AI</Badge>
                        ) : null}
                        {unresolved.get(doc.id) ? (
                          <Badge tone="amber">
                            {unresolved.get(doc.id)} open
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                        {doc.file_name} · {formatFileSize(doc.size_bytes)}
                        {isOwner ? "" : ` · from ${ownerLabel}`}
                        {doc.tags.length > 0 ? ` · ${doc.tags.join(", ")}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                      {formatDate(doc.created_at)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {alsoFoundInside.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Also mentioned inside
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            These documents do not match on title or tags, but their contents
            mention it.
          </p>
          <Card>
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {alsoFoundInside.map((match) => (
                <li key={match.documentId}>
                  <Link
                    href={`/documents/${match.documentId}`}
                    className="block px-4 py-3 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  >
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {match.documentTitle}
                      {match.pageNumber ? (
                        <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                          page {match.pageNumber}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      {match.snippet}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
