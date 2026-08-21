# Chat module

Team messaging — the thing the platform exists to replace WhatsApp with — and
the retrieval layer that lets Ask quote it back to the people who were there.

| File | Responsibility |
| --- | --- |
| `limits.ts` | Length limits, shared with the client components that enforce them |
| `config.ts` | Retrieval tuning, and the reasoning for each number |
| `queries.ts` | Reads: the inbox, a thread, its messages, unread counts |
| `actions.ts` | Writes: start, send, rename, add, mark read, leave |
| `embed.ts` | Makes a sent message semantically retrievable, after the fact |

## Why the tables are called `chat_*`

Migration 0005 already took `conversations` and `conversation_messages` for a
person's Ask thread with the model. Those are private to one person and contain
what they asked; these are shared between colleagues and contain what they said.
Two different things under one name in a schema is a bug waiting for a tired
afternoon, so the names are deliberately unlike.

## Why permissions are not in this code

Same reason as `../rag/README.md`, with a different helper. `chat_threads`,
`chat_participants` and `chat_messages` all carry policies calling
`is_chat_participant`, so Postgres removes other people's conversations before
this module sees a row. There is no filter here to forget.

`is_chat_participant` is `SECURITY DEFINER`, and that is load-bearing rather
than incidental: `chat_participants`' own select policy calls it, so a
`SECURITY INVOKER` version would re-enter that policy and recurse until Postgres
gave up.

**There is no administrator exception anywhere in this module.** Migration 0007
took document reading away from administrators on the grounds that managing
access and reading contents are different powers. Reading a colleague's private
messages is further still, and the permission-boundary test asserts it: an
administrator who is not a participant sees no threads, no messages, and gets
nothing back from `search_chat_messages`.

## Messages as a retrieval source

Ask retrieves from `chat_messages` alongside `document_chunks`. This is the
first time an answer can be grounded in something other than a document, so the
boundaries are drawn tightly:

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

## Not done

- Realtime delivery. A thread updates when the page revalidates, not when the
  other person types. Supabase Realtime on `chat_messages` is the obvious next
  step and inherits the same RLS.
- Editing and deleting a sent message. The policies allow both; no UI calls them.
- Attachments. Sharing a document into a thread should hand over a link and a
  grant, not a copy of the file — that needs the access module, not this one.
- Group threads can be created by adding a participant to a direct thread, but
  there is no "start a group" flow.
- A message is embedded once. Editing it leaves the old vector in place.
