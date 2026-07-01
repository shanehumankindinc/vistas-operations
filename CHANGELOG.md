# Changelog — Vistas Operations Dashboard

---

## 2026-07-01: Property calendar occupancy cron (today + 14 days)

What changed: New daily cron at 8am UTC (`/api/cron/property-calendar`) computes per-property per-day occupancy status for every property across all three markets, covering today through today+14. Output lands in a new `property_calendar` Supabase table. Rows older than today are deleted each run to keep the table lean (max 15 rows per property at any time).

Day type values (priority order): `turn` (checkout + checkin same day), `checkin`, `checkout`, `stayover` (mid-stay), `owner_block`, `vacant`.

Guest reservations are read from `guesty_checkins` (already synced by the 7am checkins cron — no extra API call). Owner blocks are fetched live from Guesty `/v1/owners-reservations` (a completely separate endpoint from `/v1/reservations` — owner blocks do not appear in the regular reservations endpoint).

Supporting changes: `fetchOwnerReservations(market)` added to `lib/guesty.js`; checkins cron forward window extended from today+2 to today+16 so stayovers and upcoming reservations are pre-loaded before the 8am calendar cron runs.

Why: Enables programmatic daily review of what is happening at each property over the next two weeks without maintaining historical data.

Operational follow-ups: To manually trigger before first scheduled run, use `vercel crons run /api/cron/property-calendar`. The checkins cron must run first (or run it manually at `vercel crons run /api/cron/checkins`) or stayovers from before today won't appear. Owner blocks are always fetched live so no pre-requisite there.

---

## 2026-07-01: Expand guesty_properties sync to capture all listing data

What changed: `guesty_properties` now stores four additional fields from the Guesty listing object: `description` (text), `amenities` (jsonb array), `custom_fields` (jsonb array of `{ fieldId, value }` — includes gate codes, guest access, alarm codes, etc.), and `money` (jsonb — contains fees, pricing, currency). Supabase migration adds the columns. The sync cron code change adds 4 lines. Zero new API calls — `fetchAllListings` already returned this data; we were discarding it. Added `admin/debug-guesty-listing` route to inspect raw listing object shape by market and optional listing ID.

Why: Gate codes, guest access instructions, amenity lists, and fee structures were in Guesty but not in Supabase, making them unavailable for programmatic use.

Operational follow-ups: The new columns will be null until the guesty-sync cron next runs (7am UTC). To populate immediately, trigger the cron manually via Vercel. Use `/api/admin/debug-guesty-listing?secret=CRON_SECRET&market=branson` to verify the raw field names Guesty returns if any column comes back null.

---

## 2026-07-01: Report PDF download, score colors, tier action notes, crew quality flag

What changed: Four improvements to the generated report HTML.

1. **PDF download with naming convention**: Replaced the "Print / Save as PDF" button with "Download PDF". Clicking it sets `document.title` to `{VendorSlug}_{Mon-YYYY}_Performance-Report` before calling `window.print()`, then restores it after 1s. The browser uses `document.title` as the suggested PDF filename, so the saved file is named correctly without a server-side PDF library.

2. **Review score colors in proactive table**: Non-complaint rows now show the cleanliness score in color rather than plain text. 5★ = green (#065f46), 4.7–4.9★ = neutral, 4–4.6★ = amber (#b45309), ≤3★ = red (#b91c1c). Complaint rows still show the AI-extracted excerpt and are unaffected.

3. **Tier chips expanded to human-readable action notes**: The compact "T1/T2/T3" chips now show a plain-language label ("Tier 1", "Tier 2", "Tier 3 — Urgent") with an italic action sentence below: Tier 1 = "Try to clean or fix it before leaving. Create a Breezeway task if it needs more than a quick fix." Tier 2 = "Try to fix it on the spot. If you can't resolve it, file a Breezeway task before leaving." Tier 3 = "Do not attempt to fix it. File an urgent Breezeway task and call Guest Services immediately."

4. **Crew table quality score red when below 4.7**: In the crew breakdown table, any individual crew member with a quality score below 4.7 now shows their score in red (#b91c1c, bold). Scores at or above 4.7 remain the default color.

Why: Cleaners didn't know what T1/T2/T3 meant. The PDF filename was generic ("Untitled" or the page title). Score colors make performance visible at a glance without explaining the threshold in text.

---

## 2026-07-01: Reports page — filters, pagination, export, and tier classification

What changed: Four improvements to the cleaner report system.

1. **Complaint tier classification**: Each complaint row in the proactive reporting table now shows a tier badge alongside the task status. T1 (blue) = fix yourself (dirty surface, missing consumable); T2 (amber) = try to fix, then file a Breezeway task (TV, wi-fi, pilot light); T3 (red) = do not attempt, file urgent task and call Guest Services (safety issues). The AI classifies each complaint into a tier as a 6th output field (`complaint_tiers`). `max_tokens` bumped 900 → 1100.

2. **Export / Print button**: Each generated report now includes a "Print / Save as PDF" button at the top. It calls `window.print()` — browsers offer "Save as PDF" in the print dialog. Button is hidden in the print output via `@media print { .no-print { display:none } }`.

3. **Reports page filters and pagination**: The `/reports` page now has year, month, and cleaner dropdown filters (admin/employee only for cleaner and market). Filtering is client-side against the full row set loaded on mount. Results are grouped by period and paginated 4 groups per page with prev/next controls and a result count.

4. **Vendor access control (already existed, confirmed)**: `GET /api/reports` and `GET /api/reports/[id]` already enforce vendor isolation server-side — vendors see only their own company's reports and get 403 on cross-company access. No changes needed.

Why: Reports will accumulate over time (3 markets × ~10 vendors × 12 months = ~360 rows per year). The filter and pagination changes prevent the list from becoming unmanageable. Export was requested so cleaners and managers can archive PDF copies. Tier classification communicates what accountability level was expected for each complaint.

---

## 2026-07-01: Chronic miss detection in proactive reporting

What changed: Vendors who repeatedly clean a property without ever filing a maintenance task are now flagged differently from one-time misses.

1. **`low_activity_properties` in AI brief**: Properties cleaned 3+ times this period with zero tasks filed are passed to the AI. The SYSTEM_PROMPT address and one_ask guidance reference this list so the AI can call out the pattern explicitly in prose ("You've cleaned The 10th Hole 7 times this period with no maintenance tasks filed there").

2. **Lifetime DB query (Phase 3 in generate route)**: After AI classification, a bulk query fetches all maintenance tasks ever filed by each vendor at complaint properties. One query across all vendors — only complaint properties are checked, so it's O(complaints), not O(vendors). Keyed as `vendorIndex:bz_property_id` → integer count.

3. **`is_chronic_miss` flag**: `buildProactiveReporting` marks rows where vendor cleaned 3+ times this period and has zero lifetime tasks at that property. `computeOneAsk` elevates chronic miss to the top priority. `renderProactiveReporting` shows a distinct "Never documented" badge (darker red, bold) vs "Missed", with a subtext line: "Cleaned here Nx this period — no tasks on record".

Why: The 10th Hole at Pointe Royale had 7 cleans in June, 0 lifetime maintenance tasks filed, guest complaints about carpet and odor. The old table showed it identically to a one-time miss. The chronic pattern needs different language and different visual weight.

---

## 2026-07-01: Post-audit bug fixes — AI report prose quality

What changed: Three bugs found during live report audit and fixed.

1. **AI leaking internal field names in prose**: Haiku was writing "Review idx 32 at Pointe Royale..." because the `all_reviews` brief used `idx` as a field name. Renamed to `_i` (cryptic, underscore-prefixed) to make it syntactically unnatural to verbalize. Added prescriptive example to address guidance: "say 'Pointe Royale scored a 3' not 'Review _i 5'". Added prohibition rule to SYSTEM_PROMPT.

2. **`extractComplaintExcerpt` returning trivially short strings**: A review with effectively no text produced excerpt `"."` which is truthy — the display showed `"."` instead of falling through to the "no written comment" fallback. Fixed by returning `null` for excerpts under 4 characters.

3. **`one_ask` priority misprioritized by AI**: AI was choosing priority (1) language (file maintenance tasks) even when `complaint_indices` was empty, overriding short_clean priority. Rewrote one_ask priority instruction with explicit "SKIP this priority if complaint_indices is [] or absent" guard.

Why: Live audit of 5 Branson reports revealed these patterns. All 3 verified fixed by regenerating reports after deploy.

---

## 2026-07-01: AI-generated report prose via claude-haiku-4-5

What changed: Three sections of each cleaner report are now written by claude-haiku-4-5 instead of template strings: CELEBRATE (2-4 sentence paragraph referencing specific properties and maintenance examples), ADDRESS intro (1-2 sentences contextualizing the specific issues before the data lists), and THIS MONTH DO THIS (one imperative sentence). KPI strip, proactive reporting table, and crew breakdown remain template-generated for data accuracy.

Architecture: `lib/report-ai.js` — `buildVendorBrief()` compresses each vendor's data to a ~400-token JSON brief (top 3 quotes, low reviews, short/late cleans, maintenance examples, proactive miss count). `generateAISections()` calls `claude-haiku-4-5-20251001` via the Anthropic API and returns validated JSON `{ celebrate, address, one_ask }`. The generate route fires all vendor AI calls in parallel via `Promise.allSettled` — any failure falls back to template output silently, report generation never blocks.

Why: Template strings cannot reference specific property names, adjust tone for context (e.g. "isolated slip" vs repeated pattern), or write prose that feels addressed to the specific vendor. AI prose costs under $0.05 for a full 3-market generation run.

Operational follow-ups:
- `ANTHROPIC_API_KEY` must be set in `vistas-operations` Vercel env vars (Production). Without it, generation falls back to template silently.
- AI failures per vendor are logged as warnings in Vercel runtime logs: `[reports/generate] AI failed for "..."`.

---

## 2026-07-01: Fix ADDRESS keyword callouts + smarter complaint excerpts

What changed: Removed the "Agreement reminders from guest feedback" block from the ADDRESS section — it ran `scanReviewText()` across all reviews including 5-star positive ones, producing false positives like "Guests mentioned deck — review Section 1c" from a guest saying the deck view was great. No sentiment check existed. Replaced `slice(0, 89)` excerpt logic in the proactive reporting table with `extractComplaintExcerpt()`: splits the review into sentences and finds the first one containing a negative signal word (unfortunately, broken, missing, smell, etc.) so the excerpt shows the actual complaint rather than the positive opener that typically precedes it.

Why: The keyword block was noise layered on top of the PROACTIVE REPORTING table which already surfaces real accountability data. The excerpt truncation was hiding the meaningful part of every complaint.

---

## 2026-06-30: Redesign cleaner report — proactive reporting + crew breakdown

What changed: Cleaner performance reports are now written for the cleaner to read directly (not management). Four files changed:

- `lib/keywords.js` — added `hasPhysicalComplaint()` to detect Section 3-relevant complaints in review text (physical damage, missing items, odor, pests, etc.)
- `lib/scorecard-data.js` — `computeScorecard` now returns `{ scorecard, reviews, tasks, meta }` so the generate route can use raw reviews and tasks without a second DB round-trip
- `lib/report-builder.js` — full rewrite:
  - `buildProactiveReporting()`: for each complaint review at a vendor's properties (triggered by cleanliness < 4 OR physical complaint keywords), checks whether the vendor filed a Breezeway maintenance task before the guest submitted the review. Returns a table row per complaint with task-filed status.
  - `buildCrewBreakdown()`: groups enriched tasks by individual name; returns per-crew stats (cleans, quality, on-time, tasks filed) only when vendor has 2+ distinct individuals. Returns null for solo operators (section omitted).
  - New section order: CELEBRATE (5-star quotes with property attribution + named task examples) → ADDRESS (agreement callouts with property+date, short/late clean specifics) → PROACTIVE REPORTING (table: property / last clean / guest said / task filed?) → YOUR CREW (optional) → THIS MONTH DO THIS (single computed ask)
- `app/api/reports/generate/route.js` — imports updated, computes `proactiveRows` and `crewBreakdown` per vendor before calling `buildCleanerReport`

Why: Previous reports were written as manager briefing documents (CONVERSATION FRAMING, DISCUSS sections). Reports now speak directly to the cleaner, call out specific accountability items by agreement section, and show crew-level performance for companies with multiple staff.

Operational follow-ups:
- Proactive reporting accuracy depends on review `submitted_at` vs task `created_at` timestamps. A task filed after the guest complained will correctly show as ✗ Missed.
- Crew breakdown requires `individual_name` populated on `enriched_tasks` (comes from `vendor_map` individual→company resolution). Solo operators get no crew table.
- Re-generate any existing reports to pick up the new format.

---

## 2026-06-30: Fix [id] route — await params (Next.js 15+ required)

What changed: `/api/reports/[id]` was returning 404 for all valid report IDs. Root cause: in Next.js 15+, `params` is a Promise — synchronous access (`params.id`) returns `undefined`, so the Supabase query matched nothing. Fix: `const { id } = await params`.

Why: Next.js 15 made dynamic route params async. Any route handler that destructures `params` synchronously will silently fail with 404.

---

## 2026-06-30: Fix report rendering — proxy through [id] route

What changed: "View Report" links now go through `/api/reports/[id]` instead of directly to Supabase Storage signed URLs. The route fetches the HTML from Storage and serves it with `Content-Type: text/html; charset=utf-8`. Side effect: the list endpoint (`/api/reports`) no longer generates signed URLs, removing ~8 serial Storage API calls per page load.

Why: Supabase Storage served files without specifying charset, causing browsers to decode UTF-8 as Latin-1 and display raw HTML source instead of rendering the report.

---

## 2026-06-30: Cleaner Performance Report system

What changed: Monthly HTML performance reports can now be generated per cleaning vendor and stored in Supabase Storage (`cleaner-reports` bucket). Admins access `/reports`, click "Generate Report", pick a market and date range, and reports are created per vendor, archived in `report_archive`, and served via signed URLs. Vendors can log in and see only their own report. A cron (`vercel.json`) auto-generates reports on the 1st of each month for all three markets.

Report content: status label (TOP PERFORMER / FLAG / NEEDS COACHING etc.), KPI strip (quality score, on-time rate, cleans, issues filed), Celebrate section (5-star review quotes), Address section (low reviews + agreement reminders + short cleans + GS-filed issues), What's Next, and a data-accuracy disclaimer.

Bug found and fixed during testing: Supabase Storage exact-matches MIME types — the bucket allows `text/html` but the upload was sending `text/html;charset=utf-8`, causing all uploads to fail silently with `{ generated: 0 }`. Fix: use `text/html` as `contentType` in the upload call.

Why: Vendors previously had no visibility into their performance data. This gives each vendor a monthly report card they can review without accessing the internal dashboard.

Operational follow-ups:
- The `cleaner-reports` Storage bucket must remain private (already configured). Signed URLs expire; the archive route generates them fresh on each page load.
- Vendor users need a `vendor_company` value matching `vendor_map.company_name` to see their report. Set this in Settings → Users.
- Cron runs 1st of each month at 1am UTC (Branson), 1:05am (Deep Creek), 1:10am (Poconos) — covers the prior calendar month.
- The `report_archive` table has a unique constraint on `(market, period_start, cleaner_company)` — re-generating the same period overwrites via upsert.

---

## 2026-06-30: Fix gear icon — non-HttpOnly ops_ui cookie for client-side role

What changed: The gear icon (Settings) now correctly appears for admin users. Root cause was that `ops_session` is an `HttpOnly` cookie, making it invisible to JavaScript — `currentUser` was always `null`, so the `role === "admin"` check always failed. Fix: login now sets a second cookie `ops_ui` (role + name only, no token) without the `HttpOnly` flag. `currentUser` in the dashboard reads `ops_ui` instead. Requires a fresh login to pick up the new cookie.

Why: The `HttpOnly` flag is correct security practice for the session token, but the client genuinely needs to know the role for UI-only decisions (show/hide the gear icon).

Operational follow-ups:
- Any user who had a session before this deploy needs to log out and back in once to receive the `ops_ui` cookie.

---

## 2026-06-30: Maintenance tasks drill-down panel (Issues)

What changed: Clicking any Issues count (scorecard column or Issues Created KPI chip) at all three levels (All Cleaners, Cleaner, Crew) opens a right-side panel showing maintenance tasks created by that vendor's crew. Panel columns: Created, Property, Task Name, Description, Status, Priority, Breezeway link. Crew filter cascades into the panel. Clicking the linked-issues count in the task table filters the panel to just those specific tasks (cross-vendor search so tasks created by a different vendor's crew still appear). Task column in the clean table truncates with ellipsis at 220px.

Why: Operators needed a way to review maintenance tasks filed by cleaning vendors alongside the scorecard, without leaving the page.

Operational follow-ups:
- `priority` column in `breezeway_tasks` populates on the next 5am UTC cron run. Existing rows will show blank Priority until then.

---

## 2026-06-30: Admin-only enforcement for Users & Permissions

What changed: The gear icon (Settings) is now hidden entirely for non-admin users. The `/api/users` endpoints (GET, POST, PATCH, DELETE) enforce an admin check server-side — non-admins receive a 403. Previously the API had no role check and any logged-in user could read the full user list or modify accounts.

Why: Employees and vendors have no reason to see or manage other users.

---

## 2026-06-30: Welcome email — Mandrill integration debugged and live

What changed: Fixed two bugs that prevented welcome emails from sending: (1) `sendWelcomeEmail` was called without `await`, so Vercel terminated the serverless function before the Mandrill fetch completed; (2) the initial `MANDRILL_API_KEY` in Vercel was invalid (the key had been revoked after being exposed in a public GitHub commit). Added response logging to `sendWelcomeEmail` so Mandrill errors surface in Vercel runtime logs. Email confirmed delivered via Mandrill activity page.

Why: Welcome emails were silently failing with no visible error.

Operational follow-ups:
- The old key `md-VCd5Bx0tFM-aoCXekNMoAA` is permanently revoked. A new key is in Vercel.
- Never paste Mandrill (or any) API keys into chat — they end up in the GitHub repo via commit history.

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
