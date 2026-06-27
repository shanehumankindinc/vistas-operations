# Changelog — Vistas Operations Dashboard

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
