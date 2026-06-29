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
