# Demonstration script — AIC Internal Document Platform

Fifteen minutes, structured around the problem Bishop actually named: company
documents are being passed around on WhatsApp. Every section below shows one
thing WhatsApp cannot do.

**Before you start:** two accounts signed in on two browsers (or one normal and
one private window). Call them **you** (administrator) and **the colleague**
(member). Have two or three real AIC documents to hand — a product document, an
update, and an i363 item — plus one document the colleague should *not* see.

---

## 1. The problem, in one sentence (1 min)

> "Right now a document goes into a WhatsApp group and then it is gone — you
> cannot tell who has it, you cannot take it back, and in six months nobody can
> find it. This is the same document, in a place where all three of those are
> possible."

Show the login screen. Point out there is no *Sign up* link, and say why: this
is an internal tool, and the only way in is an invitation from an administrator.

## 2. Bringing someone in (2 min)

On your screen: **Team → Invite**, enter the colleague's address, choose
*member*, send.

On the colleague's screen: open the email, set a password, land on the
dashboard.

> "They never chose to join. AIC decided they were staff, and that is the only
> way an account exists."

Worth saying out loud: their dashboard is empty. They can see nothing by default.

## 3. Putting a document in (2 min)

Upload the product document. Give it a title, a one-line description, and tags —
`product docs`, and whatever else fits.

While it uploads, point at the **AI indexing** row on the document page moving
from *Waiting to be indexed* to *Searchable by AI*, and how many passages it
found.

> "It stored the file, and it also read it. That second part is what makes the
> next section possible."

## 4. Controlled access (3 min) — the heart of it

Refresh the colleague's dashboard. **The document is not there.** Say that
plainly; it is the single most important moment in the demo.

Now share it: **Share → pick the colleague → Grant**. Refresh their screen; it
appears, marked *Shared*.

Then revoke it. Refresh; it is gone again.

> "That is the thing WhatsApp cannot do. Not the upload — the taking back."

If somebody asks whether this is enforced properly, that is the cue for:

> "It is enforced in the database itself, not in the app. Even if a future
> feature forgets to check, the database will not return the row."

## 5. Finding things again (2 min)

Upload the other two documents first if you have not already.

- Search a word that is in a *title* — the document appears.
- Search a word that is only *inside* a document — it appears under **Also
  mentioned inside**, with the passage and page number.
- Click a tag; the list filters to it.

> "At ten documents this is convenient. At two hundred it is the difference
> between the platform being used and being abandoned."

## 6. Asking a question (3 min)

Go to **Ask**. Ask something whose answer is genuinely inside one of the
documents — a date, an eligibility rule, a figure.

Point at three things in the answer:

1. The numbered citations, and that clicking one opens the document it came from.
2. The **Sources** list underneath, with page numbers.
3. That the answer stays inside the documents.

Now the part worth planning for: ask something the documents do **not** cover.
It will say so rather than invent an answer. Do this deliberately — it is more
persuasive than a correct answer.

Then, if there is time, the permission demonstration again from the AI side: ask
the same question from the colleague's account, on a document not shared with
them, and get nothing.

> "The AI can only answer from documents you were already allowed to open. The
> permission check is the same one the document list uses."

## 7. What this is not, yet (2 min)

Be straight about the edges. It buys credibility for everything above.

- Scanned documents with no text layer cannot be read yet — that needs OCR, and
  choosing an OCR tool needs real AIC scans to test against.
- Answering sends the relevant passages to Anthropic's API. **This is the
  decision that needs Bishop**: whether that is acceptable for AIC's documents,
  or whether it needs a different arrangement.
- Roles are administrator and member at the platform level, and viewer,
  commenter, editor or owner on each document. The student/tutor/admin
  structure once floated is out permanently — this platform is corporate.
  Administrators manage access but cannot read documents unless an owner
  shares one with them.

## 8. What to ask for (30 sec)

Three things, and only three:

1. **Sample documents** — the real formats AIC circulates, so the parsers can be
   tested against them rather than against guesses.
2. **A decision on the AI provider**, given the privacy point above.
3. **The email domain** staff accounts will use.

---

## If something goes wrong mid-demo

| Symptom | What to say and do |
| --- | --- |
| Indexing sits on *Waiting* | "It queues behind the upload." Move on; come back and press **Re-index**. |
| Ask says answering is unconfigured | The API key is not set on that environment. Show search instead — it works without any AI key. |
| An answer cites the wrong passage | Show it honestly, and note the citation is exactly what makes that visible. A system that cannot be checked is worse than one that can. |
| The invitation email is slow | Keep talking; it usually lands within a minute. Have a second account already invited as a fallback. |
