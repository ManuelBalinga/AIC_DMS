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
