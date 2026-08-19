-- Private storage bucket for document bytes.
--
-- Deliberately NO storage RLS policies for the `authenticated` role: browsers
-- never touch this bucket directly. Uploads go through the server route, and
-- reads go through short-lived signed URLs that are only minted after the
-- server has checked `can_read_document`. That keeps a single, auditable
-- permission gate instead of duplicating access rules in storage path parsing.

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 52428800)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;
