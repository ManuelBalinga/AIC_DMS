/**
 * Hand-maintained application-facing database types, matching the shape
 * `supabase-js` expects (Row / Insert / Update / Relationships per table).
 * Internal relations such as the migration ledger and private RLS helpers are
 * deliberately absent because application code must never address them.
 *
 * Regenerate from the live project once the Supabase CLI is linked:
 *   npx supabase gen types typescript --linked > src/lib/types/database.ts
 */

export type UserRole = "administrator" | "member";
export type InvitationStatus = "pending" | "accepted" | "revoked";
export type DocumentIndexStatus = "pending" | "processing" | "indexed" | "failed";
export type MessageRole = "user" | "assistant";

/**
 * What a grant on a document permits. Ordered — viewer < commenter < editor —
 * matching the Postgres enum, so a comparison answers a permission question.
 * Ownership is `documents.owner_id`, deliberately not a value here.
 */
export type DocumentRole = "viewer" | "commenter" | "editor";

export const DOCUMENT_ROLE_RANK: Record<DocumentRole, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
};

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  /** Set when the person can no longer sign in. Their documents are untouched. */
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
}

export type Invitation = {
  id: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
}

export type DocumentRecord = {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  tags: string[];
  index_status: DocumentIndexStatus;
  indexed_at: string | null;
  index_error: string | null;
  chunk_count: number;
  summary: string | null;
  summary_generated_at: string | null;
  suggested_tags: string[];
  created_at: string;
  updated_at: string;
}

export type DocumentAccess = {
  document_id: string;
  user_id: string;
  role: DocumentRole;
  granted_by: string | null;
  created_at: string;
}

export type DocumentComment = {
  id: string;
  document_id: string;
  author_id: string | null;
  parent_id: string | null;
  body: string;
  page_number: number | null;
  quoted_text: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
}

export type DocumentChunk = {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  token_count: number | null;
  page_number: number | null;
  /**
   * Situating text prepended to `content` at embedding time only. Never shown
   * to a reader and never part of a citation: the citation quotes the document.
   */
  context_header: string | null;
  embedding: string | null;
  created_at: string;
}

/** One row of `match_document_chunks` / `search_document_chunks`. */
export type RetrievedChunk = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  chunk_index: number;
  page_number: number | null;
  content: string;
}

/** One row of `related_documents`. */
export type RelatedDocument = {
  document_id: string;
  title: string;
  tags: string[];
  similarity: number;
}

export type Conversation = {
  id: string;
  user_id: string;
  title: string;
  summary: string | null;
  summary_through_seq: number | null;
  message_count: number;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  seq: number;
  role: MessageRole;
  content: string;
  retrieval_mode: string | null;
  passage_count: number | null;
  resolved_query: string | null;
  created_at: string;
}

export type CitationKind = "document" | "message";

export type MessageCitation = {
  id: string;
  message_id: string;
  position: number;
  kind: CitationKind;
  document_id: string | null;
  /** Set when `kind` is "message". */
  thread_id: string | null;
  document_title: string;
  page_number: number | null;
  excerpt: string;
}

/**
 * A message between team members. Distinct from `ConversationMessage`, which is
 * a turn in somebody's Ask thread with the model — different table, different
 * privacy rules, deliberately different name.
 */
export type ChatThreadKind = "direct" | "team";
export type ChatTeamVisibility = "open" | "closed";

export type ChatThread = {
  id: string;
  created_by: string | null;
  /** Team name. Null for a direct message, where the participants are the subject. */
  topic: string | null;
  kind: ChatThreadKind;
  /** Legacy compatibility flag maintained by the database from `kind`. */
  is_group: boolean;
  /** Team purpose; direct messages do not carry one. */
  purpose: string | null;
  /** Team discovery boundary; null for direct messages. */
  visibility: ChatTeamVisibility | null;
  message_count: number;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export type ChatParticipant = {
  thread_id: string;
  user_id: string;
  joined_at: string;
  /** Null means never opened, which correctly reads as unread. */
  last_read_at: string | null;
}

export type ChatMessage = {
  id: string;
  thread_id: string;
  sender_id: string | null;
  body: string;
  /** Root message for a one-level reply, or null for the main timeline. */
  parent_id: string | null;
  embedding: string | null;
  created_at: string;
  edited_at: string | null;
  retracted_at: string | null;
  retracted_by: string | null;
}

export type DocumentTeamAccess = {
  document_id: string;
  team_id: string;
  role: DocumentRole;
  granted_by: string | null;
  created_at: string;
}

export type ChatDocumentReference = {
  id: string;
  message_id: string;
  document_id: string | null;
  created_at: string;
}

export type ReferenceableDocument = Pick<DocumentRecord, "id" | "title" | "mime_type">;

export type ChatDocumentReferenceProjection = {
  message_id: string;
  locked: boolean;
  document_id: string | null;
  title: string | null;
  mime_type: string | null;
};

export type ChatMention = {
  message_id: string;
  mentioned_user_id: string;
  created_at: string;
}

export type ChatReaction = {
  message_id: string;
  user_id: string;
  emoji: ChatReactionEmoji;
  created_at: string;
}

export type ChatReactionEmoji = "👍" | "❤️" | "🎉" | "👀" | "✅";

export type ChatMessageVersion = {
  id: string;
  message_id: string;
  body: string;
  edited_by: string | null;
  created_at: string;
}

/** One row of `match_chat_messages` / `search_chat_messages`. */
export type RetrievedMessage = {
  message_id: string;
  thread_id: string;
  thread_topic: string | null;
  sender_name: string;
  body: string;
  created_at: string;
}

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Pick<Profile, "id" | "email"> &
          Partial<Omit<Profile, "id" | "email">>;
        Update: Partial<Profile>;
        Relationships: Relationship[];
      };
      invitations: {
        Row: Invitation;
        Insert: Pick<Invitation, "email"> & Partial<Omit<Invitation, "email">>;
        Update: Partial<Invitation>;
        Relationships: Relationship[];
      };
      documents: {
        Row: DocumentRecord;
        Insert: Pick<
          DocumentRecord,
          | "owner_id"
          | "title"
          | "file_name"
          | "storage_path"
          | "mime_type"
          | "size_bytes"
        > &
          Partial<Omit<DocumentRecord, "owner_id" | "title" | "file_name" | "storage_path" | "mime_type" | "size_bytes">>;
        Update: Partial<DocumentRecord>;
        Relationships: Relationship[];
      };
      document_access: {
        Row: DocumentAccess;
        Insert: Pick<DocumentAccess, "document_id" | "user_id"> &
          Partial<Omit<DocumentAccess, "document_id" | "user_id">>;
        Update: Partial<DocumentAccess>;
        Relationships: Relationship[];
      };
      document_comments: {
        Row: DocumentComment;
        Insert: Pick<DocumentComment, "document_id" | "body"> &
          Partial<Omit<DocumentComment, "document_id" | "body">>;
        Update: Partial<DocumentComment>;
        Relationships: Relationship[];
      };
      document_chunks: {
        Row: DocumentChunk;
        Insert: Pick<DocumentChunk, "document_id" | "chunk_index" | "content"> &
          Partial<
            Omit<DocumentChunk, "document_id" | "chunk_index" | "content" | "embedding">
          > & {
            /**
             * pgvector accepts the JSON array form of a float vector on insert,
             * which is what the embedding provider returns. Reads come back as
             * the string form, hence the two shapes.
             */
            embedding?: number[] | string | null;
          };
        Update: Partial<DocumentChunk>;
        Relationships: Relationship[];
      };
      conversations: {
        Row: Conversation;
        Insert: Pick<Conversation, "user_id"> & Partial<Omit<Conversation, "user_id">>;
        Update: Partial<Conversation>;
        Relationships: Relationship[];
      };
      conversation_messages: {
        Row: ConversationMessage;
        Insert: Pick<
          ConversationMessage,
          "conversation_id" | "seq" | "role" | "content"
        > &
          Partial<
            Omit<ConversationMessage, "conversation_id" | "seq" | "role" | "content">
          >;
        Update: Partial<ConversationMessage>;
        Relationships: Relationship[];
      };
      message_citations: {
        Row: MessageCitation;
        Insert: Pick<
          MessageCitation,
          "message_id" | "position" | "document_title" | "excerpt"
        > &
          Partial<
            Omit<MessageCitation, "message_id" | "position" | "document_title" | "excerpt">
          >;
        Update: Partial<MessageCitation>;
        Relationships: Relationship[];
      };
      chat_threads: {
        Row: ChatThread;
        Insert: Partial<ChatThread>;
        Update: Partial<ChatThread>;
        Relationships: Relationship[];
      };
      chat_participants: {
        Row: ChatParticipant;
        Insert: Pick<ChatParticipant, "thread_id" | "user_id"> &
          Partial<Omit<ChatParticipant, "thread_id" | "user_id">>;
        Update: Partial<ChatParticipant>;
        Relationships: Relationship[];
      };
      chat_messages: {
        Row: ChatMessage;
        Insert: Pick<ChatMessage, "thread_id" | "body"> &
          Partial<Omit<ChatMessage, "thread_id" | "body">>;
        Update: Partial<ChatMessage>;
        Relationships: Relationship[];
      };
      chat_document_references: {
        Row: ChatDocumentReference;
        Insert: Pick<ChatDocumentReference, "message_id" | "document_id"> &
          Partial<Omit<ChatDocumentReference, "message_id" | "document_id">>;
        Update: Partial<ChatDocumentReference>;
        Relationships: Relationship[];
      };
      document_team_access: {
        Row: DocumentTeamAccess;
        Insert: Pick<DocumentTeamAccess, "document_id" | "team_id"> &
          Partial<Omit<DocumentTeamAccess, "document_id" | "team_id">>;
        Update: Partial<DocumentTeamAccess>;
        Relationships: Relationship[];
      };
      chat_mentions: {
        Row: ChatMention;
        Insert: Pick<ChatMention, "message_id" | "mentioned_user_id"> &
          Partial<Omit<ChatMention, "message_id" | "mentioned_user_id">>;
        Update: Partial<ChatMention>;
        Relationships: Relationship[];
      };
      chat_reactions: {
        Row: ChatReaction;
        Insert: Pick<ChatReaction, "message_id" | "user_id" | "emoji"> &
          Partial<Omit<ChatReaction, "message_id" | "user_id" | "emoji">>;
        Update: Partial<ChatReaction>;
        Relationships: Relationship[];
      };
      chat_message_versions: {
        Row: ChatMessageVersion;
        Insert: Pick<ChatMessageVersion, "message_id" | "body"> &
          Partial<Omit<ChatMessageVersion, "message_id" | "body">>;
        Update: Partial<ChatMessageVersion>;
        Relationships: Relationship[];
      };
    };
    Views: Record<never, never>;
    Functions: {
      can_manage_document: {
        Args: { check_document_id: string; check_user_id: string };
        Returns: boolean;
      };
      can_comment_on_document: {
        Args: { check_document_id: string; check_user_id: string };
        Returns: boolean;
      };
      visible_document_tags: {
        Args: Record<never, never>;
        Returns: { tag: string; document_count: number }[];
      };
      match_document_chunks: {
        Args: {
          query_embedding: number[] | string;
          match_count?: number;
          min_similarity?: number;
        };
        Returns: (RetrievedChunk & { similarity: number })[];
      };
      search_document_chunks: {
        Args: { query_text: string; match_count?: number };
        Returns: (RetrievedChunk & { rank: number })[];
      };
      related_documents: {
        Args: {
          source_document_id: string;
          match_count?: number;
          min_similarity?: number;
        };
        Returns: RelatedDocument[];
      };
      find_or_create_direct_thread: {
        Args: { other_user_id: string };
        Returns: string;
      };
      send_chat_message: {
        Args: {
          target_thread_id: string;
          message_body: string;
          reply_to_id?: string | null;
          mentioned_user_ids?: string[];
          referenced_document_ids?: string[];
          reference_mode?: "require_access" | "locked" | "grant_team";
        };
        Returns: string;
      };
      list_chat_document_references: {
        Args: { target_thread_id: string };
        Returns: ChatDocumentReferenceProjection[];
      };
      list_referenceable_documents: {
        Args: Record<string, never>;
        Returns: ReferenceableDocument[];
      };
      document_reference_gap_count: {
        Args: { target_thread_id: string; target_document_id: string };
        Returns: number;
      };
      create_team: {
        Args: {
          team_name: string;
          team_purpose: string;
          team_visibility: ChatTeamVisibility;
          initial_member_ids?: string[];
        };
        Returns: string;
      };
      join_team: {
        Args: { target_thread_id: string };
        Returns: undefined;
      };
      add_team_member: {
        Args: { target_thread_id: string; target_user_id: string };
        Returns: undefined;
      };
      remove_team_member: {
        Args: { target_thread_id: string; target_user_id: string };
        Returns: undefined;
      };
      team_document_grant_count: {
        Args: { target_team_id: string };
        Returns: number;
      };
      match_chat_messages: {
        Args: {
          query_embedding: number[] | string;
          match_count?: number;
          min_similarity?: number;
        };
        Returns: (RetrievedMessage & { similarity: number })[];
      };
      search_chat_messages: {
        Args: { query_text: string; match_count?: number };
        Returns: (RetrievedMessage & { rank: number })[];
      };
      next_message_seq: {
        Args: { target_conversation_id: string };
        Returns: number;
      };
    };
    Enums: {
      user_role: UserRole;
      invitation_status: InvitationStatus;
      document_index_status: DocumentIndexStatus;
      message_role: MessageRole;
      citation_kind: CitationKind;
      document_role: DocumentRole;
      chat_thread_kind: ChatThreadKind;
      chat_team_visibility: ChatTeamVisibility;
    };
    CompositeTypes: Record<never, never>;
  };
}
