@ARCHITECTURE.md

# Docs in This Repo

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Architecture reference: markets, services, Supabase tables, data flow, gotchas
- **[CHANGELOG.md](CHANGELOG.md)** — Running log of every change made to this project; update at the end of every session (Phase 8)

# Secrets

- **`CRON_SECRET`** — Found in Vercel → vistas-operations → Settings → Environment Variables. Required to manually trigger `/api/admin/run-bz-sync?secret=VALUE`.
