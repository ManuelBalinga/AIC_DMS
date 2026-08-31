# Chat module

Team messaging — the thing the platform exists to replace WhatsApp with — and
the retrieval layer that lets Ask quote it back to the people who were there.

This documents the evolving `chat_*` implementation. Migrations `0011`&ndash;`0014`
cover collaboration and retention, durable Direct/Team identity, open/closed
visibility, Team document grants and permission-aware document references.

| File | Responsibility |
| --- | --- |
| `limits.ts` | Length limits, shared with the client components that enforce them |
| `config.ts` | Retrieval tuning, and the reasoning for each number |
| `queries.ts` | Reads: the inbox, a thread, its messages, unread counts |
| `actions.ts` | Writes: start, send, rename, add, mark read, leave |
| `presentation.ts` | Client-safe message types, names and reply-tree grouping |
| `embed.ts` | Makes a sent message semantically retrievable, after the fact |

## Why the tables are called `chat_*`

Migration 0005 already took `conversations` and `conversation_messages` for a
person's Ask thread with the model. Those are private to one person and contain
what they asked; these are shared between colleagues and contain what they said.
Two different things under one name in a schema is a bug waiting for a tired
afternoon, so the names are deliberately unlike.

## Why permissions are not in this code

Same reason as `../rag/README.md`, with a different helper. `chat_threads`,
`chat_participants` and `chat_messages` carry request-aware policies, so Postgres
removes content outside the current Team/Direct boundary before this module sees
a row. There is no filter here to forget.

`is_chat_participant` is `SECURITY DEFINER`, and that is load-bearing rather
than incidental: `chat_participants`' own select policy calls it, so a
`SECURITY INVOKER` version would re-enter that policy and recurse until Postgres
gave up.

Administrators have a metadata-only exception for closed Teams: they can see the
Team and manage membership, but cannot read its messages or references unless
they join. They never receive a Direct-message exception. Open Teams are already
readable by every active staff member, including administrators.

## Messages as a retrieval source

Ask retrieves from `chat_messages` alongside `document_chunks`. This is the
first time an answer can be grounded in something other than a document, so the
boundaries are drawn tightly:

- **Never a direct message.** Participation is necessary but not sufficient.
  Migration `0009` filters both retrieval functions on `is_group`, and
  `embed.ts` declines to compute a vector for a one-to-one message at all, so a
  private conversation is not a retrieval source however it is queried. Both
  layers earn their place: the keyword arm reads `body` and needs no vector, so
  withholding the embedding alone would have hidden a direct message from
  semantic search while leaving it fully reachable by keyword.
- **Only your own conversations.** Enforced by the same RLS that governs
  reading them, through a `SECURITY INVOKER` function. You can only ever be
  quoted things you could already open.
- **Documents outrank messages.** Documents are listed first in the passage
  block whatever the scores say, because the model reads earlier passages as
  more authoritative, and where a document and a remark disagree the document
  is what the organisation stands behind.
- **Fewer messages than documents** (`MESSAGE_RETRIEVAL_COUNT` is 4 against 10),
  and a **higher similarity floor** (0.35 against 0.15). Short texts embed
  noisily, and quoting a colleague's half-remembered aside as though it settled
  something is a specific kind of wrong.
- **Cited differently.** A message citation is tinted differently in the answer,
  links to the conversation rather than to a document, and the system prompt
  requires the model to attribute it in the prose — "Ama said in March that…"
  rather than stating it flatly as policy.

Messages are embedded individually, not with their surrounding thread. That is a
deliberate limit: "sounds good to me" genuinely is not retrievable, and
manufacturing context for it from neighbouring messages would make it match
questions it cannot answer.

## Collaboration and retention

Migration `0011` adds one-level replies, relational participant mentions,
reactions, versioned edits and irreversible retraction. Those are database
rules, not UI conventions: a reply cannot cross conversations or become a
second-level parent; a mention must identify a real participant; reactions are
written as the caller; and ordinary users have no message-delete privilege.

Editing appends the previous body to `chat_message_versions`, clears the stale
embedding and schedules a replacement. Retraction retains the final body for a
separately authorised audit, replaces the ordinary message with a tombstone and
hides retained versions from participants. This preserves evidence without
turning retention into a browse-history feature.

## Document references are not attachments

Migration `0014` stores only a relational pointer. It never copies a title,
filename, excerpt, URL or file bytes into chat. The base reference table is not
selectable through the Data API; a narrow projection returns a title and ID only
when the current reader can open the document, otherwise it returns a generic
locked card. Existing cards therefore lock or unlock as permissions change.

Before sending, the composer reports how many conversation readers lack access.
The sender can grant Team Viewer access and send in one transaction, post a
locked card, review the document's sharing panel or cancel the reference. The
final send recomputes access so a membership change between warning and click
cannot silently widen disclosure. Direct messages may reference a document but
can never grant permissions.

## Not done

- Realtime delivery. A thread updates when the page revalidates, not when the
  other person types. Supabase Realtime on `chat_messages` is the obvious next
  step and inherits the same RLS.
- File attachments remain forbidden. Governed document references are the only
  supported way to point from a message to a file.
