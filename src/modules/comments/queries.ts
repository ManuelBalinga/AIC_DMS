import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { DocumentComment, Profile } from "@/lib/types/database";

/**
 * Reads over document comments.
 *
 * No permission filter here, as everywhere else: `document_comments_select`
 * calls `can_read_document`, so comments are exactly as private as the document
 * they hang on — no more, no less. Since administrators lost the ability to
 * read documents, they lost the comments with them, and there is no second rule
 * to keep in step.
 */

export type CommentAuthor = Pick<Profile, "id" | "full_name" | "email">;

export type CommentWithAuthor = DocumentComment & {
  author: CommentAuthor | null;
};

/** A top-level comment and everything said in reply to it. */
export type CommentThread = CommentWithAuthor & {
  replies: CommentWithAuthor[];
};

const AUTHOR_SELECT =
  "*, author:profiles!document_comments_author_id_fkey (id, full_name, email)";

/**
 * Every comment on a document, arranged into threads.
 *
 * One query, then grouped in memory: a document has tens of comments, not
 * thousands, and a second round trip per thread would cost more than the
 * grouping ever will.
 */
export async function listCommentThreads(
  documentId: string,
): Promise<CommentThread[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("document_comments")
    .select(AUTHOR_SELECT)
    .eq("document_id", documentId)
    .order("created_at", { ascending: true })
    .returns<CommentWithAuthor[]>();

  const comments = data ?? [];
  const threads = comments
    .filter((comment) => comment.parent_id === null)
    .map((comment) => ({ ...comment, replies: [] as CommentWithAuthor[] }));

  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  for (const comment of comments) {
    if (comment.parent_id) byId.get(comment.parent_id)?.replies.push(comment);
  }

  // Unresolved first, then by page, then oldest first. Someone opening a
  // document wants to see what is still waiting on them, and a placed comment
  // is easier to find when the list runs in the order the pages do.
  return threads.sort((a, b) => {
    if ((a.resolved_at === null) !== (b.resolved_at === null)) {
      return a.resolved_at === null ? -1 : 1;
    }
    if (a.page_number !== b.page_number) {
      return (a.page_number ?? Infinity) - (b.page_number ?? Infinity);
    }
    return a.created_at.localeCompare(b.created_at);
  });
}

/**
 * How many unresolved threads each of these documents has.
 *
 * Takes a list of ids rather than being called per document: the dashboard
 * shows a badge on every row, and one query for twenty documents beats twenty.
 */
export async function countUnresolvedComments(
  documentIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (documentIds.length === 0) return counts;

  const supabase = await createClient();
  const { data } = await supabase
    .from("document_comments")
    .select("document_id")
    .in("document_id", documentIds)
    .is("parent_id", null)
    .is("resolved_at", null);

  for (const row of data ?? []) {
    counts.set(row.document_id, (counts.get(row.document_id) ?? 0) + 1);
  }

  return counts;
}
