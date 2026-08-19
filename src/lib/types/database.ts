/**
 * Hand-maintained database types, matching the shape `supabase-js` expects
 * (Row / Insert / Update / Relationships per table).
 *
 * Regenerate from the live project once the Supabase CLI is linked:
 *   npx supabase gen types typescript --linked > src/lib/types/database.ts
 */

export type UserRole = "administrator" | "member";
export type InvitationStatus = "pending" | "accepted" | "revoked";
export type DocumentIndexStatus = "pending" | "processing" | "indexed" | "failed";
export type MessageRole = "user" | "assistant";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
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
  created_at: string;
  updated_at: string;
}

export type DocumentAccess = {
  document_id: string;
  user_id: string;
  granted_by: string | null;
  created_at: string;
}

export type DocumentChunk = {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  token_count: number | null;
  page_number: number | null;
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

export type MessageCitation = {
  id: string;
  message_id: string;
  position: number;
  document_id: string | null;
  document_title: string;
  page_number: number | null;
  excerpt: string;
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
    };
    Views: Record<never, never>;
    Functions: {
      can_manage_document: {
        Args: { check_document_id: string; check_user_id: string };
        Returns: boolean;
      };
      can_read_document: {
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
    };
    CompositeTypes: Record<never, never>;
  };
}
