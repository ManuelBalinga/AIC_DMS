import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { requireProfile } from "@/modules/auth/session";
import { getDocument } from "@/modules/documents/queries";
import {
  INDEX_STATUS_LABELS,
  formatFileSize,
} from "@/modules/documents/constants";
import { deleteDocument } from "@/modules/documents/actions";
import { listDocumentGrants } from "@/modules/access/queries";
import { listTeamMembers } from "@/modules/users/queries";
import { getRelatedDocuments } from "@/modules/intelligence/queries";
import { listCommentThreads } from "@/modules/comments/queries";
import { Badge, Button, Card } from "@/components/ui";
import { DocumentPreview, isPreviewable } from "./document-preview";
import { EditForm } from "./edit-form";
import { ReindexForm } from "./reindex-form";
import { SharePanel } from "./share-panel";
import { SuggestedTags } from "./suggested-tags";
import { RelatedDocuments } from "./related-documents";
import { CommentPanel } from "./comment-panel";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const INDEX_TONES = {
  indexed: "green",
  processing: "amber",
  pending: "neutral",
  failed: "red",
} as const;

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();

  // Returns null when the user has no grant on this document, so an
  // unauthorised visit is indistinguishable from a missing document.
  const document = await getDocument(id);
  if (!document) notFound();

  const canManage =
    document.owner_id === profile.id || profile.role === "administrator";

  const [grants, teamMembers] = canManage
    ? await Promise.all([listDocumentGrants(document.id), listTeamMembers()])
    : [[], []];

  // Permission-aware through RLS on the underlying chunks, so this runs for
  // every viewer rather than only for managers.
  const [related, commentThreads] = await Promise.all([
    getRelatedDocuments(document.id),
    listCommentThreads(document.id),
  ]);

  // Asked of the database rather than derived from the grant list, so the UI and
  // the policy cannot disagree about who may comment.
  const supabase = await createClient();
  const { data: canComment } = await supabase.rpc("can_comment_on_document", {
    check_document_id: document.id,
    check_user_id: profile.id,
  });

  const grantedIds = new Set(grants.map((grant) => grant.user_id));
  const shareableMembers = teamMembers.filter(
    (member) => member.id !== document.owner_id && !grantedIds.has(member.id),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          &larr; All documents
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              {document.title}
            </h1>
            {document.owner_id === profile.id ? (
              <Badge tone="blue">Owner</Badge>
            ) : (
              <Badge tone="neutral">Shared with you</Badge>
            )}
          </div>
          {document.description ? (
            <p className="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
              {document.description}
            </p>
          ) : null}
          {document.summary ? (
            <div className="mt-3 max-w-2xl border-l-2 border-neutral-200 pl-3 dark:border-neutral-800">
              <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Summary
              </p>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                {document.summary}
              </p>
            </div>
          ) : null}
          {document.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {document.tags.map((tag) => (
                <Link key={tag} href={`/dashboard?tag=${encodeURIComponent(tag)}`}>
                  <Badge tone="neutral">{tag}</Badge>
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex gap-2">
          <Link href={`/api/documents/${document.id}/download?disposition=inline`}>
            <Button variant="secondary">Open</Button>
          </Link>
          <Link href={`/api/documents/${document.id}/download`}>
            <Button>Download</Button>
          </Link>
        </div>
      </div>

      {isPreviewable(document.mime_type) ? (
        <DocumentPreview
          documentId={document.id}
          mimeType={document.mime_type}
          title={document.title}
        />
      ) : null}

      {canManage && document.suggested_tags.length > 0 ? (
        <SuggestedTags
          documentId={document.id}
          suggestions={document.suggested_tags}
        />
      ) : null}

      <RelatedDocuments related={related} />

      <CommentPanel
        documentId={document.id}
        threads={commentThreads}
        canComment={Boolean(canComment)}
        canResolveAny={canManage}
        currentUserId={profile.id}
      />

      <Card className="p-5">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Details
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {[
            ["File name", document.file_name],
            ["Size", formatFileSize(document.size_bytes)],
            ["Type", document.mime_type],
            [
              "Owner",
              document.owner?.full_name || document.owner?.email || "Unknown",
            ],
            ["Uploaded", formatDateTime(document.created_at)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">{label}</dt>
              <dd className="mt-0.5 truncate text-sm text-neutral-900 dark:text-neutral-100">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                AI indexing
              </h2>
              <Badge tone={INDEX_TONES[document.index_status]}>
                {INDEX_STATUS_LABELS[document.index_status]}
              </Badge>
            </div>
            <p className="mt-1 max-w-xl text-sm text-neutral-500 dark:text-neutral-400">
              {document.index_status === "indexed"
                ? `${document.chunk_count} passage${
                    document.chunk_count === 1 ? "" : "s"
                  } are searchable from Ask${
                    document.indexed_at
                      ? `, indexed ${formatDateTime(document.indexed_at)}`
                      : ""
                  }. Only people this document is shared with can retrieve them.`
                : document.index_error ||
                  "This document has not been added to the AI index yet."}
            </p>
          </div>

          {canManage ? (
            <ReindexForm
              documentId={document.id}
              hasBeenIndexed={document.index_status === "indexed"}
            />
          ) : null}
        </div>
      </Card>

      {canManage ? (
        <>
          <EditForm
            documentId={document.id}
            title={document.title}
            description={document.description ?? ""}
            tags={document.tags}
          />

          <SharePanel
            documentId={document.id}
            grants={grants}
            shareableMembers={shareableMembers}
          />

          <Card className="flex flex-wrap items-center justify-between gap-3 border-red-200 p-5 dark:border-red-900">
            <div>
              <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                Delete this document
              </h2>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Removes the file, its access grants and its AI index. This cannot
                be undone.
              </p>
            </div>
            <form action={deleteDocument}>
              <input type="hidden" name="document_id" value={document.id} />
              <Button type="submit" variant="danger">
                Delete
              </Button>
            </form>
          </Card>
        </>
      ) : null}
    </div>
  );
}
