# Offline access — implemented design and deployment boundary

Decided 20 August 2026. Built on 1 September in application code and migration
`0017_offline_document_leases.sql`; not deployed until migrations `0010`–`0017`
are applied before the matching application release.

---

## 1. Why this exists

AIC is in Accra. Patchy connectivity and power cuts are not edge cases, and a
document platform that cannot be read on a bad connection is one people work
around. The workaround is WhatsApp, which is the thing this project exists to
replace. Offline access is close to load-bearing for adoption rather than a
convenience.

## 2. The tension, and why it resolves

This platform exists to control who can open a document and to be able to take
that back. **An offline file sits outside that.** Once a PDF is on a laptop,
revoking access does not remove it, the audit trail stops, and you have the
WhatsApp problem again — a file on a device nobody controls.

The reframe that settles it:

> **The Download button already exists.**

Today, when the connection drops, somebody hits Download and puts a permanent,
invisible, uncontrolled copy on their disk. That is the status quo, and it is
worse than anything below. A managed offline cache is **strictly more controlled
than what people already do**, so this is not a loosening of the model. It is a
better-behaved alternative to something already happening.

## 3. An offline copy is a lease, not a gift

| Property | Behaviour |
| --- | --- |
| **Where it lives** | Cached in the browser, not saved to the Downloads folder |
| **Who chooses** | Anyone who can read the document, unless the owner forbade it |
| **How long** | **30 days** without the device reconnecting, then it purges itself |
| **Revocation** | On reconnect, every cached document is re-checked against current permissions; anything lost is purged |
| **Sign-out** | Purges everything, immediately |
| **Record** | Who took what offline, and when |

That last row is worth dwelling on: the Download button gives you **no** record
at all today. Offline mode is the first time taking a document away becomes
visible, which fits the evidence framing chosen for
[message retention](./TEAM_COMMUNICATION.md).

### Why 30 days and not 14

14 was the first recommendation, balancing two failure modes: too short and
somebody returns from a fortnight away to an empty cache, learns not to trust
the feature and goes back to Download; too long and a lost laptop holds readable
copies for that whole window.

That reasoning was weaker than it first appeared. **If a laptop is stolen, the
thief almost certainly has the active browser session too** — so they can sign
in and read everything live, not merely what happened to be cached. Lease length
only protects the narrow case where the session has ended but the cache outlived
it.

The control that actually matters is therefore **purge on sign-out and purge on
session expiry**, not the number of days. With those in place, 30 costs little
and buys real tolerance for Accra's connectivity. Manuel's call, and the right
one.

## 4. Default on, with an owner veto

Decided: **anyone who can read a document can take it offline**, unless the
owner marks it *never offline*.

The alternative — opt in per document — sounds safer and is not, in practice.
Most documents would never get the flag set, so people would keep hitting
Download, which is the uncontrolled path. A control that pushes people toward
the worse option is not a control.

The veto exists for the genuinely sensitive document where an owner wants to
guarantee it is only ever read against a live permission check.

## 5. What works with no connection

| | Offline |
| --- | --- |
| Read cached documents | Yes |
| Document list, tags, metadata search | Yes |
| Upload | **Queued**, syncs on reconnect |
| Comments and chat | No — requires the server; queued writes remain a later pass |
| Ask | No — needs the server and the model |

**The upload queue matters as much as the reading.** A dropped connection
mid-upload is how a document ends up never filed at all, which is the same
failure as never uploading it. Both are in the first cut for that reason.

The app is installable as a PWA. Its service worker deliberately caches only
the offline shell and immutable framework assets; authenticated HTML, APIs,
signed URLs and document bytes are excluded.

## 6. Two honest limits

**This is not a security control.** Browser storage is not a boundary against
somebody holding the device, and a screenshot defeats every measure above. It is
convenience with guardrails, and saying so plainly is better than overselling
it. What it improves on is the *uncontrolled* copy people make today.

**A revoked document may stay readable until reconnection.** That is inherent to
offline, not a defect of this design. The 30-day lease is the upper bound on how
long, and sign-out closes it immediately.

## 7. Implementation notes

- **Ordinary downloads redirect to a 60-second signed URL; offline grants use a
  separate five-minute URL.** The service worker never caches either. The
  browser deliberately fetches the bytes into IndexedDB.
- **IndexedDB stores the bytes and metadata**, including cache time, validation
  time and lease expiry. Browser storage is not encryption and is not a defense
  against somebody controlling the same browser profile.
- **The lease expires client-side and is re-checked server-side on reconnect.**
  A client that lies about its lease still loses access the moment it connects,
  because the permission re-check is the authority.
- **The audit record is a server-side table**, written only through
  caller-checking RPCs. Authenticated clients cannot forge or edit lease rows.

## 8. Delivered first cut

**In:** mark for offline · cached reading · 30-day lease · purge on sign-out and
on revocation · the offline audit record · the upload queue.

**Also delivered:** PWA installability with a narrowly scoped service worker.

**Second pass:** queued comments and chat · selective "make everything I own
available offline".
