# Klein Sales Portal — Service API

Endpoints under `https://kleinmfgllc.com/api/` consumed by Cowork
scheduled tasks and other service-to-service callers. All require
`Authorization: Bearer <token>` unless noted.

## Authentication

Every protected endpoint expects an HTTP Bearer token in the
`Authorization` header. The token is set on the Vercel project as
`COWORK_API_TOKEN` (Production + Preview + Development scopes).

```
Authorization: Bearer <COWORK_API_TOKEN>
```

If the env var is unset, the endpoint returns `500 — Server not
configured` (fail closed). Wrong or missing token returns `401 —
Unauthorized`. Comparison is constant-time to defeat timing attacks.

To rotate: regenerate the token (e.g., `openssl rand -base64 32`),
update the Vercel env var, redeploy, and hand the new value to every
Cowork task that uses it.

---

## `GET /api/today-queue` — Phase 1

Returns the cadence-driven outreach queue for the requested date — the
same data the in-portal `/portal/today` page renders, in the contract
shape Cowork's 3pm digest task and any future digest-style consumers
build against.

### Query parameters

| Name    | Type | Default | Notes |
|---------|------|---------|-------|
| `date`  | ISO date `YYYY-MM-DD` | today in `America/New_York` | The "today" date the engine evaluates against. Use only for testing or back-dated digests. |
| `limit` | int | `25` | Max cards returned in the `queue` array. Capped at `100`. The `total` field always reports the un-truncated count. |

### Response — `200 OK`

```json
{
  "date": "2026-05-09",
  "total": 35,
  "queue": [
    {
      "lead_id": "uuid",
      "name": "Joseph Pisciotta",
      "first_name": "Joseph",
      "company": "PSA Airlines, Inc.",
      "title": "Aircraft Maintenance Manager",
      "status": "contacted",
      "days_overdue": 15,
      "follow_up_date": "2026-04-23",
      "linkedin_url": "https://www.linkedin.com/in/...",
      "linkedin_thread_id": null,
      "email": null,
      "channel": "linkedin",
      "recommended_prompt": {
        "id": "uuid",
        "title": "Follow-Up — 3 Days After Connect (General)",
        "category": "Follow-Up",
        "body_personalized": "Hi Joseph, thanks for connecting!..."
      },
      "portal_url": "https://kleinmfgllc.com/portal/today#lead-<id>"
    }
  ]
}
```

### Field semantics

- **`status`** — never one of `won`, `lost`, `invited`, `engaged`,
  `quoted`, `nurture`. Phase 1.5's outreach page owns `invited`; the
  others are intentionally out of scope for the daily forcing
  function.
- **`days_overdue`** — integer days that the matched cadence rule has
  been due. Always `>= 0`. A value of `0` means the rule landed today.
- **`follow_up_date`** — the lead-level `follow_up_date` column. With
  the new cadence engine this is a manual/legacy fallback only; the
  engine itself does not consult it. Returned for downstream consumers
  that still display it.
- **`channel`** — `email` only when the lead has a populated email
  address AND a prior `activities.type = 'email'` row exists for the
  lead. Defaults to `linkedin`.
- **`recommended_prompt.category`** — the human-readable category
  label (e.g. `"Follow-Up"`, `"Sample Follow-Up"`), not the lowercase
  underscore form stored in the database.
- **`recommended_prompt.body_personalized`** — the prompt body with
  `[Name]` replaced with `first_name` and `[Company]` replaced with
  `company`. If either field is missing on the lead, sensible
  defaults are substituted (`"there"` and `"your team"` respectively).
- **`portal_url`** — deep link that scrolls `/portal/today` to the
  matching card. Today the anchor exists but isn't yet wired for
  scroll-on-load; consumers can rely on the URL pattern stabilizing.

### Errors

| Status | Body | When |
|--------|------|------|
| `400`  | `{ error: "date must be ISO YYYY-MM-DD" }` | Malformed `date`. |
| `401`  | `{ error: "Unauthorized" }` | Missing or wrong Bearer token. |
| `500`  | `{ error: "Server not configured ..." }` | `COWORK_API_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, or `SUPABASE_SERVICE_ROLE_KEY` not set on the Vercel project. |
| `500`  | `{ error: <message> }` | Any other unexpected failure (DB error, etc.). |

### curl

```sh
# Today's queue, default limit
curl -sS https://kleinmfgllc.com/api/today-queue \
  -H "Authorization: Bearer $COWORK_API_TOKEN" | jq .

# Specific date, top 10
curl -sS "https://kleinmfgllc.com/api/today-queue?date=2026-05-15&limit=10" \
  -H "Authorization: Bearer $COWORK_API_TOKEN" | jq .

# 401 path
curl -sS https://kleinmfgllc.com/api/today-queue
# → {"error":"Unauthorized"}
```

---

---

## `POST /api/sent-invitations-sync` — Phase 1.5

Cowork-facing write endpoint. The 10pm Pacific sent-invitations scraper
posts the still-pending invitations parsed from
`linkedin.com/mynetwork/invitation-manager/sent/`. The portal dedupes
against existing `invited` leads and against pending review-queue rows,
then inserts whatever's new as `kind='new_lead'` proposals into
`review_queue` (Phase 2's UI surfaces them for Sean's approval).

### Auth

`Authorization: Bearer <COWORK_API_TOKEN>`. Same env var the
`/api/today-queue` endpoint uses.

### Request body

```json
{
  "observed_at": "2026-05-09T22:00:00-07:00",
  "invitations": [
    {
      "linkedin_url": "https://www.linkedin.com/in/joseph-pisciotta",
      "name": "Joseph Pisciotta",
      "headline": "Aircraft Maintenance Manager · PSA Airlines, Inc.",
      "sent_relative": "3 days ago",
      "sent_date_estimate": "2026-05-06"
    }
  ]
}
```

`linkedin_url` and `name` are required per row. `headline`,
`sent_relative`, and `sent_date_estimate` are stored verbatim in the
review-queue payload but optional. The portal normalizes `linkedin_url`
(lowercase host, strips trailing slash) before dedupe.

### Response — `200 OK`

```json
{
  "observed_at": "2026-05-09T22:00:00-07:00",
  "total": 12,
  "inserted": 5,
  "skipped": { "existing_lead": 4, "existing_proposal": 3 },
  "inserted_ids": ["uuid", "uuid", ...]
}
```

`skipped.existing_lead` counts URLs that already match a lead with
`status='invited'` (lead-level OR contact-level `linkedin_url`).
`skipped.existing_proposal` counts URLs that already have a pending
review-queue row from a previous run.

### Errors

| Status | Body | When |
|--------|------|------|
| `400`  | `{ error: "observed_at is required ..." }` | Missing fields. |
| `400`  | `{ error: "validation failed", details: [{index, error}] }` | A row in `invitations[]` is malformed. |
| `401`  | `{ error: "Unauthorized" }` | Missing or wrong Bearer token. |
| `500`  | `{ error: "Server not configured ..." }` | `COWORK_API_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, or `SUPABASE_SERVICE_ROLE_KEY` not set. |

---

## `POST /api/leads/log-invitation` — Phase 1.5

Portal-internal write endpoint hit by `/portal/outreach` when Sean
clicks **Send connection request**. Resolves an existing lead by
`linkedin_url` (lead-level or contact-level), otherwise creates one
with `status='invited'` and stamps `invited_at`. Always inserts a
`type='connection_request'` activity tagged with the chosen prompt.

### Auth

Cookie session — same auth as the rest of the portal. **Not** a
Cowork-facing endpoint.

### Request body

```json
{
  "linkedin_url":  "https://www.linkedin.com/in/joseph-pisciotta",
  "name":          "Joseph Pisciotta",
  "company":       "PSA Airlines, Inc.",
  "title":         "Aircraft Maintenance Manager",
  "prompt_id":     "uuid",
  "note_text":     "Hi Joseph, thanks for connecting!...",
  "source":        "outreach_page"
}
```

`linkedin_url`, `name` (must include first and last), `prompt_id`, and
`note_text` are required. The activity row stores `note_text`
truncated to 240 chars in `summary`. `source` defaults to
`"outreach_page"` if omitted.

### Response — `200 OK`

```json
{
  "ok": true,
  "lead_id": "uuid",
  "status": "invited",
  "created": true,
  "activity_id": "uuid"
}
```

`created=true` when a brand-new lead was inserted; `false` when an
existing lead was reused. `status` reflects the lead's status after
the call — when an existing lead was already past `invited` (e.g.
`contacted`), the call appends an activity but does not regress the
funnel.

---

## `POST /api/leads/:id/wake-up` — Phase 1.5

Park or unpark a lead. While `wake_up_at > now()`, the Today queue
skips the lead entirely.

### Auth

Cookie session.

### Request body

```json
{
  "wake_up_at":     "2026-08-09",
  "wake_up_reason": "Said wait until Q3 budget reset"
}
```

Pass `"wake_up_at": null` to unpark. ISO date or full ISO datetime
both accepted; bare ISO date stores midnight UTC.

### Response — `200 OK`

```json
{
  "ok": true,
  "lead_id": "uuid",
  "wake_up_at": "2026-08-09T00:00:00.000Z",
  "wake_up_reason": "Said wait until Q3 budget reset"
}
```

---

## `GET /api/leads/by-linkedin-url?url=<encoded>` — Phase 1.5

Dedupe lookup used by `/portal/outreach` to render the "already
invited" warning chip on each pasted URL.

### Auth

Cookie session.

### Response — `200 OK`

```json
{ "found": false }
```

or, when matched:

```json
{
  "found": true,
  "lead": {
    "id": "uuid",
    "status": "invited",
    "invited_at": "2026-05-05T22:00:00.000Z",
    "name": "Joseph Pisciotta",
    "company": "PSA Airlines, Inc."
  }
}
```

Matches against `leads.linkedin_url` first, falling back to
`contacts.linkedin_url`. The URL is normalized (lowercase host, strip
trailing slash) before lookup.

---

## `POST /api/cowork/trigger-sync?task=...` — Phase 1.5 / Phase 2

Portal-side proxy to the Cowork on-demand task webhooks. Hit from
`/portal/settings/sync` when Sean clicks **Sync now**. The portal does
not generate `run_id` — it returns whatever Cowork's webhook ack
contained.

### Auth

Cookie session.

### Query params

| Name | Values | Notes |
|------|--------|-------|
| `task` | `sent-invitations` (Phase 1.5), `dm-inbox` (Phase 2) | Picks which env var holds the Cowork webhook URL. |

### Required env vars (per-task)

| Task | Env var |
|------|---------|
| `sent-invitations` | `COWORK_TRIGGER_SENT_INVITATIONS_URL` |
| `dm-inbox` | `COWORK_TRIGGER_DM_INBOX_URL` |

### Response

| Status | Body | When |
|--------|------|------|
| `202`  | `{ ok: true, task, run_id, fired_at }` | Cowork acked the trigger. |
| `400`  | `{ error: "task is required ..." }` | Missing/invalid `task` param. |
| `401`  | `{ error: "Unauthorized" }` | No portal session. |
| `502`  | `{ error: "trigger_failed", message, body? }` | Cowork webhook returned non-2xx or was unreachable. |
| `503`  | `{ error: "task_not_configured", message, task }` | The env var for this task is unset. The Settings → Sync UI surfaces this as a disabled-with-explanation state. |

---

## `POST /api/inbox-sync` — Phase 2 + Phase 5 (Part A)

Cowork-facing write endpoint. The 7am LinkedIn DM scraper posts a
batch of proposals derived from walking Sean's DM inbox. Each
proposal is routed to one of two paths:

- **AUTO_APPLY** — applied directly to `activities` / `leads` and
  never seen in the review queue. Covers routine new_activity to a
  known lead, invited→contacted/engaged on first DM, and
  contacted→engaged on first inbound. These are mechanical facts
  from the scraper, so routing does NOT gate on the lead's classifier
  `state_confidence` — the 0.70 threshold (Phase 0 Decision 2) is for
  classifier outputs, not scraper proposals.
- **QUEUE_FOR_REVIEW** — `review_queue` with `status='pending'`,
  surfaced on `/portal/review-queue`. Covers won/lost transitions,
  unknown-URL new_leads, funnel-skipping stage_changes,
  `update_contact`, `set_wake_up`, and any proposal whose auto-apply
  attempt threw (payload gets `auto_apply_error` for context).

### Auth

`Authorization: Bearer <COWORK_API_TOKEN>`. Same env var the rest
of the Cowork-facing endpoints use.

### Request body

```json
{
  "observed_at": "2026-05-09T07:00:00-07:00",
  "proposals": [
    {
      "kind": "new_activity",
      "linkedin_thread_id": "2-NjFhYjIxNDE...",
      "linkedin_url": "https://www.linkedin.com/in/joseph-pisciotta",
      "payload": {
        "type": "linkedin_message",
        "summary": "Thanks Sean — happy to take a look.",
        "direction": "inbound",
        "first_message_excerpt": "Thanks Sean — happy to take a look.",
        "first_message_direction": "inbound",
        "first_message_at": "2026-05-09T06:42:00Z"
      }
    }
  ]
}
```

`kind` is one of `new_lead`, `new_activity`, `stage_change`,
`update_contact`, `set_wake_up`. The endpoint accepts any combination
of `lead_id`, `linkedin_thread_id`, and `linkedin_url` for matching;
pass whatever the scraper has. The endpoint resolves leads in this
order: `lead_id` → `linkedin_thread_id` → lead-level `linkedin_url`
→ contact-level `linkedin_url`.

### Invited-lead reconciliation

When a `new_lead` or `new_activity` proposal resolves to an existing
lead with `status='invited'`, the endpoint synthesizes an additional
`stage_change` proposal advancing the lead from `invited` to:

- `engaged` when `payload.first_message_direction === "inbound"`
  (the prospect actually replied), or
- `contacted` otherwise (we sent a follow-up after they accepted but
  they haven't said anything back yet).

The synthesized row is tagged `payload.reconciled_from = "invited_thread_match"`
and `payload.set_connection_accepted_at = observed_at`, so the
review-queue UI can call it out distinctly and the `approve` endpoint
stamps `connection_accepted_at` correctly.

### Demote `new_lead` → `new_activity`

When a `new_lead` proposal resolves to an existing non-invited lead,
it's silently demoted to `new_activity`. The original kind is
preserved in `payload.demoted_from`.

### `set_wake_up` proposals (Phase 3 deep sweep)

The deep historical sweep uses `kind: "set_wake_up"` to park
long-cold leads it finds during the one-time walk through Sean's
LinkedIn presence. Payload shape:

```json
{
  "kind": "set_wake_up",
  "lead_id": "uuid",                  // OR linkedin_thread_id / linkedin_url
  "payload": {
    "wake_up_at":     "2026-08-09",   // ISO date or full ISO datetime, or null to unpark
    "wake_up_reason": "No reply since Q4 2025 — wait for Q3 budget"
  }
}
```

The endpoint validates `wake_up_at` is a parseable ISO date/datetime
or explicitly `null`. The indefinite-park sentinel `2999-12-31` is
accepted — the approve endpoint uses it to drop the lead into the
"Parked indefinitely" pile on `/portal/leads`.

### Side effect

Every resolved lead gets `last_inbox_sync_at = observed_at` so the
next scrape can pull incrementally. The Haiku conversation-state
classifier runs once per lead that had a new_activity auto-applied;
classifier failures are logged but never roll back the activity.

### Response — `200 OK`

```json
{
  "observed_at": "2026-05-09T07:00:00-07:00",
  "total": 12,
  "auto_applied": 6,
  "queued": 3,
  "skipped": {
    "existing_proposal": 2,
    "duplicate_message_urn": 1
  },
  "queued_ids": ["uuid", "uuid", ...],
  "auto_applied_details": [
    {
      "kind": "new_activity",
      "lead_id": "uuid",
      "activity_id": "uuid"
    },
    {
      "kind": "stage_change",
      "lead_id": "uuid",
      "from_status": "invited",
      "to_status": "engaged"
    }
  ],
  "reconciled": [
    {
      "source_kind": "new_activity",
      "lead_id": "uuid",
      "from_status": "invited",
      "to_status": "engaged"
    }
  ]
}
```

### Errors

| Status | Body | When |
|--------|------|------|
| `400`  | `{ error: "observed_at is required ..." }` | Missing or malformed top-level fields. |
| `400`  | `{ error: "validation failed", details: [{index, error}] }` | A row in `proposals[]` is malformed. |
| `401`  | `{ error: "Unauthorized" }` | Missing or wrong Bearer token. |
| `500`  | `{ error: "Server not configured ..." }` | `COWORK_API_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, or `SUPABASE_SERVICE_ROLE_KEY` not set. |

---

## `POST /api/review-queue/:id/approve` — Phase 2

Applies a pending `review_queue` row to production tables. Sean
clicks Approve from `/portal/review-queue`.

### Auth

Cookie session.

### Per-kind effects

- **`new_lead`** — creates a company (when `payload.company` is given
  and an exact-name match doesn't exist), a contact, and a lead with
  `status = payload.proposed_status` (defaults to `invited`). Stamps
  `invited_at` when the proposed status is `invited`, or
  `connection_accepted_at` when `contacted` / `engaged` / `sample_sent`.
- **`new_activity`** — appends an `activities` row to the matched
  lead with `source = 'dm_inbox_scraper'`. Backfills
  `leads.linkedin_thread_id` when the proposal had one and the lead
  didn't.
- **`stage_change`** — updates `leads.status` to `payload.to_status`.
  When `payload.set_connection_accepted_at` is set (typically from
  the invited-thread reconciliation), stamps
  `leads.connection_accepted_at`. Backfills `linkedin_thread_id`
  when missing.
- **`update_contact`** — updates the lead's contact row. Accepted
  fields: `email`, `phone`, `title`, `linkedin_url`, `first_name`,
  `last_name`. Read from `payload.updates` if present, otherwise
  the top-level payload.
- **`set_wake_up`** — sets `leads.wake_up_at` and `wake_up_reason`.
  Pass `payload.wake_up_at = null` to unpark.

### Response — `200 OK`

```json
{
  "ok": true,
  "id": "uuid",
  "kind": "stage_change",
  "decided_at": "2026-05-09T14:32:00.000Z",
  "applied": { "lead_id": "uuid", "from_status": "invited", "to_status": "engaged" }
}
```

### Errors

| Status | Body | When |
|--------|------|------|
| `400`  | `{ error: <message> }` | Invalid payload (e.g. unknown `to_status`, missing `name` on `new_lead`). |
| `401`  | `{ error: "Unauthorized" }` | No portal session. |
| `404`  | `{ error: "Review queue row not found" }` | Bad `:id`. |
| `409`  | `{ error: "Already approved", decided_at, decided_by }` | Row was already decided. |
| `409`  | `{ error: "Lead already exists for that linkedin_url", lead_id }` | A `new_lead` row matched a lead created since the proposal landed. |
| `422`  | `{ error: "Cannot apply ... — no matching lead found" }` | Non-`new_lead` row that no longer resolves to a lead. |
| `500`  | `{ error: <message> }` | DB error during apply. The row stays pending so a retry is possible after fixing the underlying state. |

---

## `POST /api/review-queue/:id/reject` — Phase 2

Marks a pending `review_queue` row `status='rejected'` with no side
effects on production tables. Used when the scraper got it wrong
(recruiter spam, duplicate, mis-classification).

### Auth

Cookie session.

### Response — `200 OK`

```json
{
  "ok": true,
  "id": "uuid",
  "kind": "new_lead",
  "decided_at": "2026-05-09T14:33:00.000Z"
}
```

### Errors

| Status | Body | When |
|--------|------|------|
| `401`  | `{ error: "Unauthorized" }` | No portal session. |
| `404`  | `{ error: "Review queue row not found" }` | Bad `:id`. |
| `409`  | `{ error: "Already approved" }` | Row was already decided. |

---

## `GET /api/weekly-stats` — Phase 3

Cowork-facing read endpoint. The Sunday 7pm ET digest task hits
this once a week to render Sean's recap email.

### Auth

`Authorization: Bearer <COWORK_API_TOKEN>`. Same env var as the
other Cowork-facing endpoints.

### Query params

| Name | Values | Notes |
|------|--------|-------|
| `week` | `last` (default), `current`, `YYYY-MM-DD` | `last` = last full Mon-Sun window that has fully ended. `current` = Monday of this week through "now". A specific date returns the Mon-Sun window containing that date. Weeks are evaluated in UTC. |

### Response — `200 OK`

```json
{
  "week": {
    "start": "2026-05-04",
    "end":   "2026-05-10",
    "label": "Week of May 4"
  },
  "outreach": {
    "connection_requests_sent": 18,
    "connections_accepted":      7,
    "accept_rate":               0.3888
  },
  "engagement": {
    "outbound_messages":  32,
    "inbound_replies":    11,
    "reply_rate":         0.3437
  },
  "samples": {
    "sample_requests_received": 3,
    "shipments_sent":           5,
    "shipments_delivered":      4
  },
  "pipeline": {
    "leads_created":  22,
    "leads_parked":   3,
    "current_status_counts": {
      "new": 12, "invited": 18, "contacted": 24, "engaged": 6,
      "sample_sent": 8, "quoted": 2, "won": 4, "lost": 9, "nurture": 1
    }
  },
  "top_prompts": [
    {
      "prompt_id":               "uuid",
      "title":                   "First Contact — Aviation MRO Cold Note",
      "category":                "first_contact",
      "uses_this_week":          12,
      "leads_touched_this_week": 12,
      "replies_this_week":       4,
      "reply_rate_this_week":    0.3333
    }
  ]
}
```

### Field semantics

- **`outreach.connection_requests_sent`** counts `activities` rows
  with `type='connection_request'` and `direction='outbound'` whose
  `created_at` falls in the window.
- **`outreach.connections_accepted`** counts leads whose
  `connection_accepted_at` falls in the window — the lead may or
  may not have been created in the same week.
- **`accept_rate`** is `null` when no connection requests were sent.
- **`engagement.outbound_messages`** counts `activities` of type
  `linkedin_message`, `email`, or `follow_up` with
  `direction='outbound'` in the window.
- **`engagement.inbound_replies`** counts `activities` with
  `direction='inbound'` in the window.
- **`pipeline.current_status_counts`** is the snapshot of every
  `leads.status` value as of the request, not the count *into*
  each status during the week.
- **`top_prompts`** is at most 5 entries, ranked by `uses_this_week`
  descending. Per-prompt `reply_rate_this_week` is scoped to leads
  the prompt's outbound activity touched in the window.

---

## Future endpoints

Phase 3's deep-sweep task uses the existing `POST /api/inbox-sync`
endpoint with `kind=set_wake_up` proposals; see the inbox-sync
section above for the payload contract.
