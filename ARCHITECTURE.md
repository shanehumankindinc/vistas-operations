<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Vistas Operations Dashboard — Architecture Reference

## What This Is

A Next.js App Router dashboard (deployed on Vercel) that shows a weekly scorecard per vendor for three vacation rental markets: **Branson**, **Deep Creek**, and **Poconos**. The scorecard columns are: Cleans, Quality Score, Reviews, Refunds, and Issues.

---

## Markets

Defined in `lib/markets.js` as `MARKET_KEYS = ["branson", "deep_creek", "poconos"]`.

Each market has its own Breezeway account and (for Branson/Deep Creek/Poconos) its own Guesty account. The `MARKETS` config object maps each market key to its Breezeway env var names.

---

## External Services

### Breezeway
- REST API at `https://api.breezeway.io`
- Auth: OAuth2 client credentials → short-lived `access_token`
- **Branson**: token stored in Upstash KV at key `breezeway:access_token`, refreshed by a cron in `branson-dashboard` at 5am UTC. Read from KV in `lib/breezeway.js → getBzToken("branson")`.
- **Deep Creek / Poconos**: env vars `BREEZEWAY_CLIENT_ID_DEEPCREEK`, `BREEZEWAY_CLIENT_SECRET_DEEPCREEK`, `BREEZEWAY_CLIENT_ID_POCONOS`, `BREEZEWAY_CLIENT_SECRET_POCONOS` stored in the Vercel project. `getBzToken` calls OAuth2 for these markets and caches the result in KV for 25h.
- Key endpoint: `GET /inventory/v1/task` — returns tasks for a property.
- Task type is in `type_department` (raw BZ field). Cleaning tasks have department like "Housekeeping". Maintenance/issue tasks have "maintenance", "issue", or "repair" in the department name.
- Maintenance tasks have `scheduled_date = null` and `created_at` as the relevant date.

### Guesty
- See global `~/.claude/CLAUDE.md` for strict token rules (never call OAuth2 from here).

### Supabase
- All persisted data. Connection via `lib/db.js → getSupabase()`.
- `lib/db.js` uses the **service role key** (`SUPABASE_SERVICE_ROLE_KEY`) — server-side only, bypasses RLS by design.
- RLS is enabled on all tables with a default-deny policy for the anon role. The anon key has no read or write access.
- Never use `SUPABASE_ANON_KEY` in this project. Never use `NEXT_PUBLIC_SUPABASE_*` env vars (they would expose credentials to the browser).

### Upstash (Redis/KV)
- URL: `https://clever-bluegill-8498.upstash.io`
- Stores BZ tokens per market.

---

## Supabase Tables

### `breezeway_tasks`
One row per Breezeway task. Upserted by the sync routes using `task_id,market` as the conflict key.

| Column | Notes |
|--------|-------|
| `task_id` | Breezeway task ID (string) |
| `market` | `branson` / `deep_creek` / `poconos` |
| `property_name` | Human-readable property name |
| `bz_property_id` | Breezeway's internal property ID — used to link maintenance tasks to clean rows |
| `vendor_name` | Individual who finished the task (or "Unassigned") |
| `task_type` | Normalized from BZ `type_department` |
| `task_title` | Task name |
| `created_by` | Name of who created the task — matters for maintenance tasks (cleaner who reported it) |
| `created_at` | ISO timestamp — used as the date for maintenance tasks |
| `scheduled_date` | Date for cleaning tasks; **NULL for maintenance tasks** |
| `clean_status` | BZ status string |
| `is_finished` | Boolean |
| `pulled_at` | When the sync last touched this row |
| `description` | Task description text (maintenance tasks only) |
| `summary` | Primary task note from BZ `summary.note` (maintenance tasks only) |
| `comments` | JSONB array of `{ id, comment, comment_by, created_at }` (maintenance tasks only) |

### `ops_users`
Dashboard user accounts. Managed via Settings → Users & Permissions.

| Column | Notes |
|--------|-------|
| `id` | UUID primary key |
| `name` | Display name |
| `email` | Login email (lowercased) |
| `role` | `admin` / `employee` / `vendor` |
| `markets` | Array of market keys the user can see |
| `vendor_company` | For vendor role: the `company_name` from `vendor_map` — used to filter scorecard rows server-side |
| `password_hash` | SHA-256 of the plain-text password |
| `created_at` | Timestamp |

### `vendor_map`
Maps individual cleaner names → company names, and flags excluded vendors.

| Column | Notes |
|--------|-------|
| `market` | Market key |
| `individual_name` | Name as it appears in BZ `finished_by.name` |
| `company_name` | Display name for the scorecard (e.g. "Brandon Buchan" → "BnB Rentals & Management") |
| `excluded` | If true, that vendor's tasks are dropped from the scorecard |
| `first_seen` | Date the individual first appeared in a sync |
| `email` | Contact email — used by the Add User people picker to pre-fill the form |

### `guesty_reviews`
Populated by `cron/guesty-sync`. Key columns for review matching:

| Column | Notes |
|--------|-------|
| `listing_id` | Guesty listing ID — matches `breezeway_tasks.bz_property_id` |
| `reservation_id` | Guesty reservation MongoDB ObjectID (`r.reservationId`) — matches `guesty_checkins.reservation_id` for exact match |
| `submitted_at` | Date review was submitted (date-only) |
| `confirmation_code` | Channel booking code (`r.externalReservationId`, e.g. Airbnb HMXXXXXXXX) — NOT the same as `guesty_checkins.confirmation_code` |

### `guesty_checkins`
Populated by `cron/checkins`. Contains upcoming reservations (check-in from today onwards — Guesty API only returns future/current check-ins via the date filter).

| Column | Notes |
|--------|-------|
| `reservation_id` | Guesty reservation MongoDB ObjectID (`r._id`) — matches `guesty_reviews.reservation_id` |
| `confirmation_code` | Guesty's internal code (`r.confirmationCode`, e.g. "HA-hPMRtzJ") — NOT the same format as the channel code on reviews |
| `check_in_date` | Guest check-in date |
| `check_out_date` | Guest check-out date = clean task's `scheduled_date` |

**Important:** `guesty_checkins` only holds FUTURE reservations. The Guesty `/v1/reservations` endpoint with date filters returns only upcoming check-ins regardless of statuses requested. Historical checkout dates are not available via this table.

### `guesty_refunds`
Populated by `cron/guesty-sync`. One row per reservation with a refund reason custom field value. Read-only from data serving paths.

### `guesty_properties`
Populated by `cron/guesty-sync`. One row per Guesty listing per market. Key columns:

| Column | Notes |
|--------|-------|
| `id` | Guesty listing MongoDB ObjectID |
| `market` | `branson` / `deep_creek` / `poconos` |
| `nickname` | Short property name |
| `title` | Full listing title |
| `address` | JSONB address object |
| `accommodates` | Guest capacity |
| `bedrooms` / `bathrooms` | Room counts |
| `property_type` | Guesty property type string |
| `tags` | JSONB array of tags |
| `description` | Listing description text (`l.description` or `l.publicDescription`) |
| `amenities` | JSONB array of amenity strings/objects |
| `custom_fields` | JSONB array of `{ fieldId, value }` — includes gate codes, guest access, alarm codes, etc. |
| `money` | JSONB — full money/fees/pricing object from Guesty |
| `pulled_at` | Last sync timestamp |

---

## Key Files

```
app/
  api/
    data/route.js             ← Main scorecard data endpoint (GET /api/data)
    admin/run-bz-sync/        ← Manual BZ sync trigger (requires CRON_SECRET as Bearer or ?secret=)
    cron/breezeway-tasks/     ← Scheduled daily BZ sync (5am UTC)
lib/
  breezeway.js                ← BZ API client + token management
  markets.js                  ← Market config + isExcludedVendor()
  scorecard.js                ← buildScorecardData() — all scorecard logic
  db.js                       ← Supabase client
```

---

## Data Flow

1. **Sync** (`cron/breezeway-tasks` or `admin/run-bz-sync`):
   - For each market, fetch all BZ properties.
   - For each property, fetch cleaning tasks (by `scheduled_date` window) **and** maintenance tasks (all tasks, filtered by `type_department`).
   - Dedupe, skip excluded vendors (but never skip maintenance tasks — their creator is what counts).
   - Upsert into `breezeway_tasks`.
   - Auto-detect individual→company mapping from BZ assignment data; update `vendor_map` where `company_name` is null.

2. **Serve** (`api/data/route.js`):
   - Query `breezeway_tasks` with `scheduled_date` range for cleaning tasks.
   - **Separate query** for `task_type = 'maintenance'` using `created_at` range (maintenance tasks have `scheduled_date = null`).
   - Merge both result sets, deduped by `task_id`.
   - Apply `vendor_map`: resolve `company_name`, drop excluded vendors (maintenance tasks bypass exclusion).
   - Pass to `buildScorecardData()` alongside reviews, refunds, check-ins.

3. **Scorecard** (`lib/scorecard.js`):
   - Groups cleaning tasks by vendor + week.
   - Links maintenance tasks to clean rows by `bz_property_id` + date proximity window (−1 to +2 days from `scheduled_date`).
   - `linked_issues` on each clean row = maintenance tasks created near that clean date for the same property.

---

## Known Gotchas

- **`scheduled_date` is NULL for maintenance tasks.** Any DB query filtering on `scheduled_date` will silently exclude all maintenance tasks. Always use a separate `created_at`-filtered query for `task_type = 'maintenance'`.
- **`isExcludedVendor` must not apply to maintenance tasks.** Maintenance tasks are often "Unassigned" (no `finished_by`), which would match the excluded-vendor filter. The `isMaintTask` flag bypasses this.
- **BZ `type_department` field** is the source of truth for task type, not `task_type`. The sync normalizes it into `task_type` in the DB.
- **`created_by` is an object**, not a string: `{ name, display_name }`. Always resolve as `t.created_by?.name || t.created_by?.display_name`.
- **Branson BZ token**: only the `branson-dashboard` cron may call OAuth2. Everything else reads from KV.
- **`run-bz-sync` endpoint** requires `CRON_SECRET` as a Bearer token (`Authorization: Bearer SECRET`) or query param (`?secret=SECRET`). Auth is enforced at the route level; this path is in the middleware bypass list so Vercel can reach it without a session cookie.
- **Middleware verifies JWT signatures** — it uses Web Crypto (`crypto.subtle`) to recompute the HMAC-SHA256 of the session cookie and reject any forged or expired tokens. The secret is `AUTH_SECRET` env var (required in Vercel — never use the hardcoded fallback in production).
- **Cron routes bypass middleware** — `/api/cron/*` is in the middleware bypass list. The routes themselves verify `CRON_SECRET` as a Bearer token.
