import { getSupabase } from "@/lib/db";
import { fetchAllBzProperties, fetchBzTasksForProperty } from "@/lib/breezeway";
import { MARKET_KEYS, isExcludedVendor } from "@/lib/markets";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Runs at 5am UTC daily.
// Fetches all Breezeway properties once, then maps each to a market using
// reference_external_property_id → Guesty listing ID → market from Supabase.
// This is definitive: no state-code guessing, no company_id mismatches.
// Tasks are fetched per-property in batches of 10.
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

  // Build Guesty listing ID → market lookup from Supabase
  const { data: guestyProps, error: gpErr } = await supabase
    .from("guesty_properties")
    .select("id, market");
  if (gpErr) return Response.json({ error: `guesty_properties lookup failed: ${gpErr.message}` }, { status: 500 });

  const listingToMarket = {};
  (guestyProps || []).forEach((p) => { listingToMarket[p.id] = p.market; });

  // Fetch all Breezeway properties (no filtering — one full paginated fetch)
  const allBzProps = await fetchAllBzProperties();

  // Group BZ properties by market using the Guesty cross-reference
  const propsByMarket = {};
  MARKET_KEYS.forEach((m) => { propsByMarket[m] = []; });

  for (const prop of allBzProps) {
    const guestyId = prop.reference_external_property_id;
    const market = guestyId ? listingToMarket[guestyId] : null;
    if (market && propsByMarket[market]) {
      propsByMarket[market].push(prop);
    }
  }

  const results = {};

  for (const market of MARKET_KEYS) {
    try {
      const properties = propsByMarket[market];
      let upserted = 0;
      let errors = 0;

      // Fetch tasks per property in batches of 10
      const BATCH = 10;
      const allRows = [];

      for (let i = 0; i < properties.length; i += BATCH) {
        const batch = properties.slice(i, i + BATCH);
        const batchResults = await Promise.all(
          batch.map(async (prop) => {
            const bzId = prop.reference_property_id;
            const propName = prop.name || prop.display || String(prop.id);
            if (!bzId) return [];
            try {
              return await fetchBzTasksForProperty(bzId, propName, fromStr, toDate);
            } catch (e) {
              if (!e.message.includes("422") && !e.message.includes("404")) {
                errors++;
              }
              return [];
            }
          })
        );
        allRows.push(...batchResults.flat());
      }

      // Upsert to Supabase
      const rows = [];
      for (const t of allRows) {
        const vendorName = t.finished_by?.name || t.assigned_to || "Unassigned";
        if (isExcludedVendor(vendorName)) continue;
        rows.push({
          task_id:        String(t.id),
          market,
          property_name:  t._propName || t.name || null,
          bz_property_id: String(t.reference_property_id || t._bzId || ""),
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
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          const { error } = await supabase
            .from("breezeway_tasks")
            .upsert(chunk, { onConflict: "task_id,market" });
          if (error) throw new Error(error.message);
          upserted += chunk.length;
        }
      }

      results[market] = {
        properties: properties.length,
        tasks_fetched: allRows.length,
        upserted,
        property_errors: errors,
      };
    } catch (err) {
      results[market] = { error: err.message };
    }
  }

  return Response.json({ ok: true, results, total_bz_props: allBzProps.length });
}
