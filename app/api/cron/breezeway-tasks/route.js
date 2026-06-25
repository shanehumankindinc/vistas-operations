import { getSupabase } from "@/lib/db";
import { fetchBzTasks } from "@/lib/breezeway";
import { MARKET_KEYS, isExcludedVendor } from "@/lib/markets";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Runs at 5am UTC daily.
// Fetches the last 90 days of Breezeway tasks for all markets and upserts to Supabase.
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - 90);
  const toDate = today.toISOString().slice(0, 10);
  const fromStr = fromDate.toISOString().slice(0, 10);

  const results = {};

  for (const market of MARKET_KEYS) {
    try {
      const tasks = await fetchBzTasks(market, fromStr, toDate);
      const rows = [];

      for (const t of tasks) {
        const vendorName = t.finished_by?.name || t.assigned_to || "Unassigned";
        if (isExcludedVendor(vendorName)) continue;

        rows.push({
          task_id:        String(t.id),
          market,
          property_name:  t.name || t.property_name || null,
          bz_property_id: String(t.reference_property_id || t.property_id || ""),
          vendor_name:    vendorName,
          task_title:     t.task_title || null,
          task_type:      t.task_type || null,
          clean_status:   t.status || null,
          scheduled_date: t.scheduled_date || null,
          started_at:     t.started_at ? new Date(t.started_at).toISOString() : null,
          finished_at:    t.finished_at ? new Date(t.finished_at).toISOString() : null,
          total_time:     t.total_time || null,
          is_finished:    !!t.finished_at,
          assigned_count: t.assignments?.length || 0,
          pulled_at:      new Date().toISOString(),
        });
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from("breezeway_tasks")
          .upsert(rows, { onConflict: "task_id,market" });
        if (error) throw new Error(error.message);
      }

      results[market] = { fetched: tasks.length, upserted: rows.length };
    } catch (err) {
      results[market] = { error: err.message };
    }
  }

  return Response.json({ ok: true, results });
}
