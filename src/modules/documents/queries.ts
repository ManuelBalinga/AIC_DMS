import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { DocumentRecord, Profile } from "@/lib/types/database";

export type DocumentWithOwner = DocumentRecord & {
  owner: Pick<Profile, "id" | "email" | "full_name"> | null;
};

const OWNER_SELECT =
  "*, owner:profiles!documents_owner_id_fkey (id, email, full_name)";

export type DocumentFilters = {
  /** Free-text query, matched against title, description, file name and tags. */
  query?: string;
  /** Only documents carrying this tag. */
  tag?: string;
  /** "mine" | "shared" — narrows by ownership relative to `viewerId`. */
  scope?: "mine" | "shared";
  viewerId?: string;
};

/**
 * Documents visible to the signed-in user, optionally filtered.
 *
 * There is no explicit permission filter here on purpose: the `documents_select`
 * RLS policy already restricts rows to owned, granted, and administrator-visible
 * documents. Filtering again in the query would duplicate the rule and let the
 * two drift apart. Everything below narrows *within* that permitted set.
 */
export async function listVisibleDocuments(
  filters: DocumentFilters = {},
): Promise<DocumentWithOwner[]> {
  const supabase = await createClient();

  let builder = supabase.from("documents").select(OWNER_SELECT);

  const query = filters.query?.trim();
  if (query) {
    // `websearch` so a colleague can type `budget -draft` and have it mean what
    // it looks like. Matches the generated `search_vector` from migration 0003.
    builder = builder.textSearch("search_vector", query, {
      type: "websearch",
      config: "english",
    });
  }

  if (filters.tag) {
    builder = builder.contains("tags", [filters.tag]);
  }

  if (filters.scope && filters.viewerId) {
    builder =
      filters.scope === "mine"
        ? builder.eq("owner_id", filters.viewerId)
        : builder.neq("owner_id", filters.viewerId);
  }

  const { data } = await builder.order("created_at", { ascending: false });

  return (data as DocumentWithOwner[] | null) ?? [];
}

/** A single document, or null when the user is not allowed to see it. */
export async function getDocument(documentId: string): Promise<DocumentWithOwner | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select(OWNER_SELECT)
    .eq("id", documentId)
    .maybeSingle();

  return (data as DocumentWithOwner | null) ?? null;
}

export type TagCount = { tag: string; document_count: number };

/**
 * Tag vocabulary of the documents this user can see, most used first.
 *
 * Backed by `visible_document_tags()`, a SECURITY INVOKER function — so the
 * list itself cannot leak the tags of documents the user has no access to.
 */
export async function listVisibleTags(): Promise<TagCount[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("visible_document_tags");
  return data ?? [];
}

export type DocumentStats = {
  total: number;
  ownedByMe: number;
  sharedWithMe: number;
  indexed: number;
  awaitingIndex: number;
};

export async function getDocumentStats(userId: string): Promise<DocumentStats> {
  const documents = await listVisibleDocuments();
  const ownedByMe = documents.filter((doc) => doc.owner_id === userId).length;

  return {
    total: documents.length,
    ownedByMe,
    sharedWithMe: documents.length - ownedByMe,
    indexed: documents.filter((doc) => doc.index_status === "indexed").length,
    awaitingIndex: documents.filter(
      (doc) => doc.index_status === "pending" || doc.index_status === "processing",
    ).length,
  };
}

/**
 * The opening text of each document, for the cards on the register.
 *
 * A card that shows what is inside a document is the whole point of the grid,
 * and the obvious way to get one — rendering the first page of every file to an
 * image — is a background job, an image store, and a second set of permission
 * rules to keep in step with the first. None of that is necessary here: the
 * opening text is already extracted, already stored, and already covered by the
 * same policy as its document, because `document_chunks` is what Ask reads.
 *
 * So this returns words rather than a picture. That is not a lesser substitute:
 * a reader recognises "Industry Internship Course Outline" by its first
 * sentence far faster than by a thumbnail of grey lines at 110 pixels tall.
 *
 * One query for the whole page. Twenty cards must not be twenty round trips,
 * which is the same rule the unresolved-comment count already follows.
 *
 * No permission filter, for the usual reason: `document_chunks` carries a policy
 * calling `can_read_document`, so a chunk belonging to a document this reader
 * cannot open never reaches the application. Filtering again here would put the
 * rule in two places and let them drift.
 */
export async function listDocumentPreviews(
  documentIds: string[],
): Promise<Map<string, string>> {
  const previews = new Map<string, string>();
  if (documentIds.length === 0) return previews;

  const supabase = await createClient();
  const { data } = await supabase
    .from("document_chunks")
    .select("document_id, content")
    .in("document_id", documentIds)
    .eq("chunk_index", 0);

  for (const row of data ?? []) {
    const text = (row.content as string | null)?.replace(/\s+/g, " ").trim();
    if (text) previews.set(row.document_id as string, text);
  }

  return previews;
}
