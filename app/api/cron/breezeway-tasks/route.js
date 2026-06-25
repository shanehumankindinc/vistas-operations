import { sql } from "@vercel/postgres";
import { fetchBzTasks } from "@/lib/breezeway";
import { MARKET_KEYS, isExcludedVendor } from "@/lib/markets";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Runs at 5am UTC daily.
// Fetches the last 90 days of Breezeway tasks for all markets and upserts to Postgres.
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - 90);
  const toDate = today.toISOString().slice(0, 10);
  const fromStr = fromDate.toISOString().slice(0, 10);

  const results = {};

  for (const market of MARKET_KEYS) {
    try {
      const tasks = await fetchBzTasks(market, fromStr, toDate);
      let upserted = 0;

      for (const t of tasks) {
        const vendorName = t.finished_by?.name || t.assigned_to || "Unassigned";
        if (isExcludedVendor(vendorName)) continue;

        const finishedAt = t.finished_at ? new Date(t.finished_at).toISOString() : null;
        const startedAt = t.started_at ? new Date(t.started_at).toISOString() : null;
        const scheduledDate = t.scheduled_date || null;

        await sql`
          INSERT INTO breezeway_tasks (
            task_id, market, property_name, bz_property_id, vendor_name,
            task_title, task_type, clean_status, scheduled_date,
            started_at, finished_at, total_time, is_finished, assigned_count, pulled_at
          ) VALUES (
            ${String(t.id)}, ${market}, ${t.name || t.property_name || null},
            ${String(t.reference_property_id || t.property_id || "")},
            ${vendorName}, ${t.task_title || null}, ${t.task_type || null},
            ${t.status || null}, ${scheduledDate},
            ${startedAt}, ${finishedAt}, ${t.total_time || null},
            ${!!t.finished_at}, ${t.assignments?.length || 0}, NOW()
          )
          ON CONFLICT (task_id, market) DO UPDATE SET
            vendor_name    = EXCLUDED.vendor_name,
            clean_status   = EXCLUDED.clean_status,
            started_at     = EXCLUDED.started_at,
            finished_at    = EXCLUDED.finished_at,
            total_time     = EXCLUDED.total_time,
            is_finished    = EXCLUDED.is_finished,
            task_type      = EXCLUDED.task_type,
            pulled_at      = NOW()
        `;
        upserted++;
      }

      results[market] = { fetched: tasks.length, upserted };
    } catch (err) {
      results[market] = { error: err.message };
    }
  }

  return Response.json({ ok: true, results });
}
