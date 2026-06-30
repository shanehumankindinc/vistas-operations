# Changelog — Vistas Operations Dashboard

---

## 2026-06-30: Users & Permissions — people picker, vendor isolation, welcome email, password toggle

What changed: Full rebuild of the user management flow in the Settings drawer.

1. **People picker** — "Add User" now opens a directory sourced from `vendor_map` (people with emails). Grouped as Employees (`excluded=true AND company_name IS NULL`) and Vendors by market (`excluded=false`). People already in `ops_users` are marked "Already a user" and non-selectable. Selecting a person pre-fills name, email, role, and market.

2. **Role-aware form** — Vendor role shows a single market dropdown + Company field. Employee/Admin role shows multi-market checkboxes. `vendor_company` column added to `ops_users` and included in session tokens.

3. **Vendor data isolation** — `/api/data` decodes the `ops_session` cookie server-side (no client trust). Vendor sessions are forced to their assigned market and their scorecard rows are filtered to their `vendor_company`. Enforced on the server; client cannot override.

4. **Welcome email** — On user creation, sends a transactional email via Mandrill from `noreply@bransonvistas.com` with login URL, email, and plain-text password. Non-fatal if Mandrill fails (user is still created). Requires `MANDRILL_API_KEY` env var in Vercel.

5. **Password visibility toggle** — Password field in Add/Edit User form has an eye icon button to toggle between masked and visible text.

Why: Admins needed a way to onboard Breezeway people as dashboard users without manually typing details, and vendors needed to be locked to their own data server-side.

Operational follow-ups:
- `MANDRILL_API_KEY` must be set in Vercel env vars (value: `md-VCd5Bx0tFM-aoCXekNMoAA`).
- `vendor_company text` column must exist on `ops_users` table in Supabase (add if not present: `ALTER TABLE ops_users ADD COLUMN vendor_company text;`).
- `email text` column must exist on `vendor_map` table (used by the people picker directory endpoint).
- Vendor data isolation is enforced in `/api/data` only. If other data endpoints are added later, the same `getSessionUser` + role check pattern must be applied.

---

## 2026-06-29: Review match accuracy — from 54% to 98%

What changed: Reviews now match to clean tasks at 98.1% (663/676) versus 53.7% (363/676) before. Three root causes were fixed:

1. **Broken Guesty reservation fetch** — the `fields` param in `fetchReservationsByCheckIn` was silently stripping `checkIn`, `checkOut`, and `customFields` from all responses. Removed the param entirely; the full object is returned and we pick what we need. This also means `guesty_checkins.check_in_date` and `check_out_date` are now correctly populated for the first time.

2. **Task window too narrow for review attribution** — reviews are fetched 60 days back (so late reviews for pre-window cleans are available), but tasks were only fetched for the 30-day scorecard window. Added a pre-window task query (same 60-day lookback) used exclusively for review matching. Vendor stats still only count tasks in the 30-day window.

3. **Two-pass review matching** — `buildTaskReviewMap` now runs two passes: pass 1 is exact match via `reservation_id → check_out_date → task.scheduled_date`; pass 2 is the existing 1-60 day date-window heuristic. Pass 1 requires `reservation_id` on both `guesty_reviews` and `guesty_checkins` — those columns were added and are now populated by their respective syncs.

Why: 313 reviews were appearing as unmatched in the dashboard even though their cleans exist in Breezeway — those cleans just happened slightly before the 30-day window. The fix adds the correct task lookback to match the review lookback that was already in place.

Operational follow-ups:
- The old `guesty_checkins` rows (pre-fix) had `_id` stored as `confirmation_code` because the fields filter was stripping the real `confirmationCode`. Those rows were deleted and repopulated correctly by re-running the checkins cron.
- `cleaner_feedback` remains 0 in `guesty_checkins` — likely `cleanerFeedbackFieldId` is not configured or the custom field is not being filled by guests. Not related to this fix.
- The 13 truly orphaned reviews (no clean task found in any 60-day window) are for properties with Guesty reviews but no Breezeway task — likely owner cleans or deactivated properties. Nothing to do.

---

## 2026-06-28: Security hardening — auth and Supabase access

What changed: Middleware now verifies the HMAC-SHA256 signature of the `ops_session` cookie instead of only checking that the cookie exists. `lib/db.js` switched from the anon key to the service role key. Cron routes added to the middleware bypass list so Vercel cron jobs can reach their handlers.

Why: The cookie-existence-only check was a complete authentication bypass — anyone could set `ops_session=anything` in dev tools and access all data. RLS is disabled on Supabase tables, so switching to the service role key (the correct server-side credential) and enabling RLS with default-deny protects the database even if credentials leak.

Operational follow-ups:
- `SUPABASE_SERVICE_ROLE_KEY` must be added to Vercel env vars for this project before the next deployment works.
- `AUTH_SECRET` must be set in Vercel (confirm it is not using the hardcoded fallback `vistas-ops-dev-secret-2026` which is visible in the public GitHub repo).
- RLS must be enabled on all Supabase tables (`breezeway_tasks`, `vendor_map`, `guesty_reviews`, `guesty_refunds`, `guesty_checkins`, `guesty_properties`, `ops_users`) with a default-deny policy for the anon role. Do this AFTER the deployment is green.
- All active sessions will be invalidated on deploy (users log in once and it works normally after).

---

## 2026-06-27 (continued)

### Feat: GS Cleaner Feedback wired for all three markets
**Files:** `lib/markets.js`, `lib/scorecard.js`, `app/api/data/route.js`, `app/page.tsx`

Field IDs discovered by calling `GET /v1/accounts/{accountId}/custom-fields` via the Open API using cached KV tokens. IDs confirmed live:

| Market | `cleanerFeedbackFieldId` | `refundReasonFieldId` |
|---|---|---|
| Branson | `69efa455004a8900145395f4` (unchanged) | `69e92df43e89c40010c58025` (unchanged) |
| Deep Creek | `6a20d2b46ab284001357b7f0` (was wrong Branson ID) | `6a20d2e3f908c8001480d65a` (was null) |
| Poconos | `6a20d20ef1ce860013b6c54c` (was null) | `6a20d1fe9e162b001339a9a9` (was null) |

`data/route.js` now selects `cleaner_feedback, confirmation_code` from `guesty_checkins`. `buildEnrichedTasks` in `scorecard.js` indexes checkins by `listing_id:check_in_date` and attaches `cleaner_feedback` to each enriched task. `buildScorecardData` computes `feedback_count` per vendor row.

UI: Feedback column added to main scorecard table (count, purple). GS Feedback chip + Feedback text column added to cleaner drill-down view.

**Note:** The `guesty_checkins` cron already writes `cleaner_feedback` for Branson; with the correct field IDs now in `markets.js`, the next cron run will start populating DC and Poconos feedback too.

### Fix: Re-add auth to debug route
**File:** `app/api/admin/debug/route.js`

Debug endpoint was temporarily left without auth during field ID discovery. Auth restored — requires `CRON_SECRET` as Bearer token or `?secret=` query param.

---

## 2026-06-27

### Feat: Capture description, summary, and comments on maintenance tasks
**Files:** `app/api/cron/breezeway-tasks/route.js`, `app/api/admin/run-bz-sync/route.js`
**Migration:** `add_description_summary_comments_to_breezeway_tasks`

BZ's `/inventory/v1/task` list endpoint already returns these fields inline — no extra API calls needed. Added three nullable columns to `breezeway_tasks`: `description text`, `summary text`, `comments jsonb`. The sync now maps them from the BZ response for maintenance tasks only. Run a manual re-sync to backfill existing rows.

---

### Fix: Issues column always showing 0
**File:** `app/api/data/route.js`

Maintenance tasks have `scheduled_date = null`, so the existing Supabase query (filtered by `.gte("scheduled_date", fromDate)`) excluded all of them. `buildScorecardData` received an empty `allMaintTasks` array, making `linked_issues` empty on every clean row.

Fix: added a parallel query for `task_type = 'maintenance'` filtered by `created_at` range. Results are deduped by `task_id` and merged into the main task array before passing to `buildScorecardData`.

---

## 2026-06-26

### Fix: Maintenance tasks dropped during sync (excluded-vendor filter)
**Files:** `app/api/admin/run-bz-sync/route.js`, `app/api/cron/breezeway-tasks/route.js`

`isExcludedVendor("Unassigned")` returned `true`, silently dropping every maintenance task that had no `finished_by` before the DB upsert. Added `isMaintTask` flag — maintenance tasks bypass the vendor exclusion check entirely.

Result: upserted count jumped from 106 → 168 for Poconos. All 62/62 tasks in the Poconos CSV export now match the DB.

### Feature: Deep Creek and Poconos Breezeway sync
**Files:** `lib/breezeway.js`, `lib/markets.js`

Added per-market BZ token support. DC/Poconos credentials (`BREEZEWAY_CLIENT_ID_DEEPCREEK`, `BREEZEWAY_CLIENT_SECRET_DEEPCREEK`, `BREEZEWAY_CLIENT_ID_POCONOS`, `BREEZEWAY_CLIENT_SECRET_POCONOS`) added to Vercel env vars. `getBzToken(market)` reads from KV first, falls back to OAuth2 for DC/Poconos markets and caches 25h.

---

## Earlier (prior sessions)

### Initial build
- Next.js App Router dashboard deployed to Vercel
- Supabase tables: `breezeway_tasks`, `vendor_map`, `guesty_reviews`, `guesty_refunds`, `guesty_checkins`, `guesty_properties`
- Daily BZ sync cron at 5am UTC (`app/api/cron/breezeway-tasks/route.js`)
- Manual sync endpoint (`app/api/admin/run-bz-sync/route.js`)
- Scorecard logic in `lib/scorecard.js` — groups by vendor/week, links maintenance tasks to clean rows by `bz_property_id` + date proximity (−1 to +2 days)
- Vendor map auto-detection: BZ assignment `type_task_user_status="accepted"` used to detect company name from individual cleaner name
