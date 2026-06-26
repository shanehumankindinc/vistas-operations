import { getSupabase } from "@/lib/db";
import { fetchAllBzPropertiesForMarket, fetchBzTasksForProperty } from "@/lib/breezeway";
import { MARKET_KEYS, isExcludedVendor } from "@/lib/markets";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Runs at 5am UTC daily.
// Each market has its own Breezeway account — fetched independently using per-market tokens.
// Branson: token from KV (seeded by branson-dashboard revenue-pipeline cron).
// Deep Creek / Poconos: tokens fetched via OAuth2 using Vercel env var credentials,
//   then cached in KV for 23h (BREEZEWAY_CLIENT_ID_DEEPCREEK / BREEZEWAY_CLIENT_SECRET_DEEPCREEK etc.)
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

  // Build Guesty listing ID → market lookup (used to verify cross-market integrity for Branson;
  // DC and Poconos properties are all already in the right account).
  const { data: guestyProps, error: gpErr } = await supabase
    .from("guesty_properties")
    .select("id, market");
  if (gpErr) return Response.json({ error: `guesty_properties lookup failed: ${gpErr.message}` }, { status: 500 });

  const listingToMarket = {};
  (guestyProps || []).forEach((p) => { listingToMarket[p.id] = p.market; });

  const results = {};

  for (const market of MARKET_KEYS) {
    try {
      // Fetch all properties from this market's Breezeway account
      const bzProps = await fetchAllBzPropertiesForMarket(market);

      // For Branson, cross-check against Guesty to filter to only managed properties.
      // For DC/Poconos, every property in their BZ account belongs to that market.
      const properties = market === "branson"
        ? bzProps.filter((p) => {
            const guestyId = p.reference_external_property_id;
            return guestyId ? listingToMarket[guestyId] === "branson" : false;
          })
        : bzProps;

      let upserted = 0;
      let errors = 0;
      const allRows = [];

      const BATCH = 10;
      for (let i = 0; i < properties.length; i += BATCH) {
        const batch = properties.slice(i, i + BATCH);
        const batchResults = await Promise.all(
          batch.map(async (prop) => {
            const bzId = prop.reference_property_id;
            const propName = prop.name || prop.display || String(prop.id);
            if (!bzId) return [];
            try {
              return await fetchBzTasksForProperty(bzId, propName, fromStr, toDate, market);
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

      // Build rows for upsert
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

      // Auto-register any new vendor names into vendor_map (excluded=false, no company_name)
      // so they appear in the scorecard immediately and can be mapped/excluded later.
      const newVendors = [...new Set(rows.map((r) => r.vendor_name).filter(Boolean))].map((name) => ({
        market,
        individual_name: name,
        excluded: false,
        first_seen: new Date().toISOString().slice(0, 10),
      }));
      if (newVendors.length > 0) {
        await supabase
          .from("vendor_map")
          .upsert(newVendors, { onConflict: "market,individual_name", ignoreDuplicates: true });
      }

      results[market] = {
        bz_props_in_account: bzProps.length,
        properties_used: properties.length,
        tasks_fetched: allRows.length,
        upserted,
        property_errors: errors,
      };
    } catch (err) {
      results[market] = { error: err.message };
    }
  }

  return Response.json({ ok: true, results });
}
