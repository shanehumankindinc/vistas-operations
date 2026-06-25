import { sql } from "@vercel/postgres";
export { sql };

export async function runMigrations() {
  await sql`
    CREATE TABLE IF NOT EXISTS guesty_properties (
      id          TEXT NOT NULL,
      market      TEXT NOT NULL,
      nickname    TEXT,
      title       TEXT,
      address     JSONB,
      accommodates INTEGER,
      bedrooms    INTEGER,
      bathrooms   NUMERIC,
      property_type TEXT,
      tags        TEXT[],
      pulled_at   TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (id, market)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS guesty_owners (
      id          TEXT NOT NULL,
      market      TEXT NOT NULL,
      first_name  TEXT,
      last_name   TEXT,
      full_name   TEXT,
      email       TEXT,
      phone       TEXT,
      active      BOOLEAN,
      listing_ids TEXT[],
      pulled_at   TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (id, market)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS guesty_reviews (
      review_id         TEXT NOT NULL,
      market            TEXT NOT NULL,
      submitted_at      DATE,
      channel           TEXT,
      listing_id        TEXT,
      property_name     TEXT,
      owner_name        TEXT,
      confirmation_code TEXT,
      overall_score     NUMERIC,
      cleanliness       NUMERIC,
      accuracy          NUMERIC,
      checkin_score     NUMERIC,
      communication     NUMERIC,
      location          NUMERIC,
      value             NUMERIC,
      review_text       TEXT,
      private_feedback  TEXT,
      cleaner_name      TEXT,
      bz_property_id    TEXT,
      pulled_at         TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (review_id, market)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_reviews_listing
      ON guesty_reviews (market, listing_id, submitted_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS guesty_checkins (
      confirmation_code TEXT NOT NULL,
      market            TEXT NOT NULL,
      listing_id        TEXT,
      listing_nickname  TEXT,
      check_in_date     DATE,
      check_out_date    DATE,
      status            TEXT,
      cleaner_feedback  TEXT,
      pulled_at         TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (confirmation_code, market)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_checkins_date
      ON guesty_checkins (market, listing_id, check_in_date)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS breezeway_tasks (
      task_id        TEXT NOT NULL,
      market         TEXT NOT NULL,
      property_name  TEXT,
      bz_property_id TEXT,
      vendor_name    TEXT,
      task_title     TEXT,
      task_type      TEXT,
      clean_status   TEXT,
      scheduled_date DATE,
      started_at     TIMESTAMPTZ,
      finished_at    TIMESTAMPTZ,
      total_time     TEXT,
      created_by     TEXT,
      created_at     TIMESTAMPTZ,
      is_finished    BOOLEAN,
      assigned_count INTEGER,
      pulled_at      TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (task_id, market)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_tasks_vendor
      ON breezeway_tasks (market, vendor_name, scheduled_date DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_tasks_property
      ON breezeway_tasks (market, bz_property_id, scheduled_date DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS guesty_refunds (
      confirmation_code TEXT NOT NULL,
      market            TEXT NOT NULL,
      refund_date       DATE,
      guest_name        TEXT,
      property_name     TEXT,
      listing_id        TEXT,
      channel           TEXT,
      refund_amount     NUMERIC,
      refund_reason     TEXT,
      check_in          DATE,
      check_out         DATE,
      cleaner_feedback  TEXT,
      pulled_at         TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (confirmation_code, market)
    )
  `;
}
