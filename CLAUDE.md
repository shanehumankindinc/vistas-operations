@ARCHITECTURE.md

# Docs in This Repo

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Architecture reference: markets, services, Supabase tables, data flow, gotchas
- **[CHANGELOG.md](CHANGELOG.md)** — Running log of every change made to this project; update at the end of every session (Phase 8)

# Secrets

- **`CRON_SECRET`** — Found in Vercel → vistas-operations → Settings → Environment Variables. Required to manually trigger `/api/admin/run-bz-sync?secret=VALUE`.

# Gotchas

- **Guesty reservation `fields` param strips date fields** — `fetchReservationsByCheckIn` must NOT pass a `fields` param. When any `fields` value is passed, Guesty silently strips `checkIn`, `checkOut`, `confirmationCode`, and `customFields` from the response. Omit the param entirely and pick what you need from the full object on the JS side.

- **`guesty_checkins` only holds future reservations** — The Guesty `/v1/reservations` endpoint with `checkInDateFrom/checkInDateTo` filters only returns upcoming check-ins regardless of the `statuses` param. You cannot use `guesty_checkins` to look up historical checkout dates.

- **Review `confirmation_code` ≠ checkin `confirmation_code`** — `guesty_reviews.confirmation_code` is the channel booking code (e.g. Airbnb "HMXXXXXXXX" from `r.externalReservationId`). `guesty_checkins.confirmation_code` is Guesty's own code (e.g. "HA-hPMRtzJ" from `r.confirmationCode`). These are different identifiers for the same reservation. Use `reservation_id` (the Guesty MongoDB ObjectID) to join across tables.

- **Review matching needs 60-day task lookback** — Reviews are fetched 60 days before the scorecard window so late reviews for pre-window cleans are captured. Tasks must cover the same lookback or those reviews will never find a match. `computeScorecard` fetches pre-window tasks separately and passes them all to `buildTaskReviewMap`; vendor stats still filter to the 30-day window.

- **`isCleanTask` requires `task_title` to contain "clean"** — Tasks with a non-null `task_title` that doesn't include "clean" (e.g. "Inspection", "Hot Tub Service") are excluded from review matching and clean counts. The dominant Breezeway task title is "Post-Clean Checklist*" which passes this check.

- **People picker grouping rule** — `vendor_map` rows are grouped as: `excluded=true AND company_name IS NULL` → Employee; `excluded=false` → Vendor (active); `excluded=true AND company_name IS NOT NULL` → Hidden (inactive former vendor, not shown). Do not use `company_name IS NULL` alone or `excluded` alone — both conditions are required to correctly classify internal employees vs vendors who happen to lack a company mapping.

- **Vendor session cookie decoding** — `/api/data` decodes the `ops_session` cookie server-side using `Buffer.from(data, "base64url").toString()` (the payload is the first `.`-delimited segment). The HMAC is NOT re-verified here (middleware already did that); the decode is just for role/market enforcement. If you add new data endpoints, copy the `getSessionUser` helper from `api/data/route.js` and apply the same vendor guard.

- **Owner blocks are NOT in `/v1/reservations`** — They live in a completely separate endpoint: `/v1/owners-reservations`. The `statuses` filter on `/v1/reservations` is silently ignored and does not return owner blocks regardless of what status you pass. Use `fetchOwnerReservations(market)` from `lib/guesty.js` for owner block data.

- **Deployment source is GitHub, not local** — Vercel deploys from `shanehumankindinc/vistas-operations` (master branch). The local copy at `C:\Users\shane\Downloads\vistas-operations` is a diverged clone — do not use it. All changes must go through `C:\Users\shane\Downloads\vistas-operations-git` and be pushed to master.

- **Never paste API keys in chat** — they end up in GitHub commit history and get auto-revoked by Mandrill's (and other providers') secret scanners. Always set secrets directly in Vercel env vars UI.

- **`/api/users` is admin-only** — all methods (GET, POST, PATCH, DELETE) check the session cookie server-side and return 403 for non-admins. The gear icon is also hidden client-side for non-admins. If you add new user-management endpoints, apply the same `requireAdmin(req)` guard from `api/users/route.js`.
