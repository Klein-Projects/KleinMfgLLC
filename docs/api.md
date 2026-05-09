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

## Future endpoints

`POST /api/leads/log-invitation`, `POST /api/sent-invitations-sync`,
`POST /api/inbox-sync`, `POST /api/review-queue/:id/{approve,reject}`,
`GET /api/weekly-stats`, etc. are documented in the Phase 1.5 / Phase 2
/ Phase 3 build-plan appendices and will land in this doc as those
phases ship.
