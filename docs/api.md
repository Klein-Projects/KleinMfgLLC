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

## Future endpoints

`POST /api/inbox-sync`, `POST /api/review-queue/:id/{approve,reject}`,
`GET /api/weekly-stats`, etc. are documented in the Phase 2 / Phase 3
build-plan appendices and will land in this doc as those phases ship.
