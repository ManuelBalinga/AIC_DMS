# Team communication — how it will work

Decided with Manuel, 20 August 2026. Nothing here is built yet. This is the
agreed shape, written down before any schema exists, because two of these
choices are expensive to reverse once there is data in them.

The brief was "imitate Slack, for a corporate setting". What follows copies
Slack's shape where it earns its place and departs from it in three specific
ways, each noted.

---

## 1. The rule everything else obeys

> **A message can never carry a file.**

This platform exists because documents in WhatsApp could not be found,
controlled or withdrawn. A chat that accepts attachments rebuilds exactly that,
one layer further in: the same lost files, now behind our own login.

So a message may **reference** a document and never contain one. Sharing a file
means uploading it, which means it acquires an owner, permissions, tags and an
AI index whether the sender was thinking about any of that or not. The
constraint does the work that a policy document otherwise has to.

This is the first departure from Slack, and it is not negotiable without
re-opening why the project exists.

---

## 2. A Team is a group of people, not just a room

Slack separates channels (rooms) from user groups (`@product`). At twelve staff
that is bureaucracy. Here they are one object.

A **Team** has:

- a name and purpose (`Finance`, `i363`, `Product`)
- a **member list**
- a **conversation**
- **visibility**: open or closed

| Visibility | Who can find it | Who can read it | Who can join |
| --- | --- | --- | --- |
| **Open** | Everyone at AIC | Everyone at AIC | Anyone, themselves |
| **Closed** | Members only | Members only | By invitation from a member |

Open is Slack's public channel; closed is its private channel. One concept, one
member list, one mental model.

**Naming.** The existing `/admin/team` page — the roster of everyone at AIC —
gets renamed to **People**, which is a better name for a directory anyway.
"Team" then means what Manuel means by it.

---

## 3. Sharing: a person *or* a team, your choice each time

This is the second departure from Slack, and the reason Teams are worth building
here rather than bolting on a messenger. Slack channels have nothing to do with
file permissions. Ours do.

The sharing panel takes **either** target:

```
Share "2026 Budget" with:
   ○ A person     Kwame Mensah              [Viewer  ▾]
   ● A team       Finance  (3 members)      [Editor  ▾]
```

Both remain available permanently. Neither replaces the other — this was
Manuel's call, and it is what Drive and SharePoint do for the same reason:
sometimes you mean a department, sometimes you mean one colleague.

### What follows from a team grant

- Share *2026 Budget* with **Finance** → Kwame, Ama and Yaw can all open it.
- Adjoa joins Finance → she gets the budget, and everything else Finance holds.
- Yaw leaves Finance → he loses them.

### Adding a member is never silent

The consequence is shown at the moment of the decision, the same pattern used
for document references:

> **Finance has access to 14 documents.**
> Adding Adjoa gives her all of them.
> **Add** · **Cancel**

### Two grants, one person

Somebody can hold access twice — directly as *Viewer*, and through a team as
*Editor*. **The higher role wins.** `document_access.role` is already an ordered
enum (migration `0007`), so this is a `max`, not a special case.

This creates one obligation the UI must meet: the sharing panel has to show
*where* each person's access comes from. Otherwise "I removed her from Finance
and she can still see it" becomes a support call, when the truthful answer is
that she also has a direct grant.

### Direct messages never carry permissions

DMs are for "have you got a minute". Access is always granted through a Team or
a named person, so *who can see this document* stays answerable from one place.
A DM is too informal and too easy to be a permission boundary.

---

## 4. Who can read what

Consistent with the document model, which already says administrators manage
access but cannot read documents unless shared with them.

| | Open team | Closed team | DM |
| --- | --- | --- | --- |
| Members | Read and write | Read and write | Read and write |
| Other staff | Read, may join | Cannot see it exists | No |
| Administrators | Read, may join | **Manage membership, cannot read** | **No** |

Administrators can see that a closed team exists, who is in it, and can add or
remove people — because that is access management, which is their job. They
cannot read the conversation.

This was Manuel's decision, and the reasoning is the same one that kept them out
of documents: **questions are frequently more revealing than the documents they
are about**, and people write differently when they believe someone is reading.
A tool nobody speaks candidly in is one where the real conversation goes back to
WhatsApp.

---

## 5. What is copied from Slack, and what is not

### Copied

| Feature | Why it earns its place |
| --- | --- |
| Left sidebar: teams, then DMs | The one navigation pattern every user already knows |
| Unread bolding and badge counts | The only reason people open a chat tool at all |
| **Replies in threads** | Without threads a busy team is an unreadable wall |
| `@mentions` | The difference between "someone should" and "you should" |
| Emoji reactions | Cuts noise more than any other single feature: 👍 instead of four "sounds good" messages |
| Edit and delete, with an "edited" marker | People mistype. Silent editing is worse than no editing |
| Search across everything you can see | Same permission rule as everywhere else |

### Not copied

Huddles and calls · apps, bots and integrations · workflow automation · custom
emoji · external organisations (Slack Connect) · threads inside threads ·
multiple workspaces · saved items and reminders.

Each is at least a week of work and none serves twelve people sharing documents.
Named here so the omissions are chosen rather than discovered.

### Corporate rather than casual

Real names and job titles rather than handles. A visible People directory. This
is the third departure from Slack: the tone is a company intranet, not a
start-up channel.

---

## 6. Where it lives in the app

Chat gets its own sidebar **inside `/chat`**, rather than restructuring the whole
shell. The top navigation gains a **Chat** item with an unread badge.

The document side of the app genuinely does not want a channel list down the
left, and a full-height sidebar would push the document list into a column. This
keeps the two halves of the product looking like what they are.

```
Top nav:   Documents   Ask   Chat •3   People            Manuel ▾

/chat      ┌──────────────┬─────────────────────────────────┐
           │ TEAMS        │  # finance                      │
           │  # finance 3 │  ─────────────────────────────  │
           │  # i363      │  Ama    Budget's approved       │
           │  # product   │   └ 2 replies                   │
           │              │  Kwame  Referenced 2026 Budget  │
           │ DIRECT       │         [ 2026 Budget ]         │
           │  Kwame       │                                 │
           │  Ama •2      │  [ Message #finance         ]   │
           └──────────────┴─────────────────────────────────┘
```

---

## 7. First cut

Agreed scope for the first usable version, once the beta itself is verified:

**In:** teams with membership and visibility · direct messages · threaded
replies · `@mentions` · unread state · reactions · sharing a document with a
team.

**Deferred to a second pass:** promote-a-thread-to-a-document · conversations in
AI retrieval · notification digests · real-time delivery (polling first if it
buys time).

The reasoning for including DMs in the first cut rather than deferring them:
without one-to-one messaging people keep using WhatsApp for exactly that, and
one-to-one is precisely where documents leak.

---

## 8. Storage shape

Sketched, not fixed. Recorded so the reasoning survives.

- `teams`, `team_members` — the group and its roster.
- `team_messages` — kept **separate** from `document_comments`, which already
  exists. Comments hang off a document, team messages off a team; one shared
  table would need a policy branching on parent type, which is where permission
  bugs breed. Separate storage, one shared read model in the UI and in
  retrieval.
- `document_team_access` — a new table beside `document_access` rather than a
  nullable column inside it. `document_access` is already applied and already
  carries policies; adding an OR clause to `can_read_document` is a smaller and
  more reviewable change than reshaping a live table's primary key.
- Direct messages reuse `teams` with a two-person membership and a `kind` of
  `dm`, rather than a parallel system. Two message stores means two permission
  models and, eventually, a discrepancy between them.

---

## Still open

- Whether an open team's conversation should be searchable by AI for people who
  are not members. Leaning yes for open teams, no for closed and never for DMs,
  but it needs deciding before retrieval is wired up.
- Message retention. Nothing deletes today. Worth a decision before real
  conversation accumulates rather than after.
