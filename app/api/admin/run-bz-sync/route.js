import { getSupabase } from "@/lib/db";
import { fetchAllBzPropertiesForMarket, fetchBzTasksForProperty, fetchBzMaintenanceTasksForProperty } from "@/lib/breezeway";
import { MARKET_KEYS, isExcludedVendor } from "@/lib/markets";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Manual trigger for the Breezeway task sync — same logic as the cron but
// callable via browser with a secret query param.
// GET /api/admin/run-bz-sync?secret=CRON_SECRET&market=branson  (market optional, default: all)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const marketParam = searchParams.get("market") || "all";
  const markets = marketParam === "all" ? MARKET_KEYS : [marketParam];

  const supabase = getSupabase();
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - 90);
  const toDate = today.toISOString().slice(0, 10);
  const fromStr = fromDate.toISOString().slice(0, 10);

  const { data: guestyProps, error: gpErr } = await supabase
    .from("guesty_properties")
    .select("id, market");
  if (gpErr) return Response.json({ error: `guesty_properties lookup failed: ${gpErr.message}` }, { status: 500 });

  // Refresh Branson BZ token into KV if needed (branson-dashboard cron may not have run)
  if (markets.includes("branson") && process.env.BREEZEWAY_CLIENT_ID && process.env.BREEZEWAY_CLIENT_SECRET) {
    try {
      const bzAuth = await fetch("https://api.breezeway.io/public/auth/v1/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: process.env.BREEZEWAY_CLIENT_ID, client_secret: process.env.BREEZEWAY_CLIENT_SECRET }),
      });
      if (bzAuth.ok) {
        const { access_token } = await bzAuth.json();
        const { Redis } = await import("@upstash/redis");
        const kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
        await kv.set("breezeway:access_token", access_token, { ex: 82800 });
      }
    } catch { /* non-fatal — getBzToken will error clearly if still missing */ }
  }

  const listingToMarket = {};
  (guestyProps || []).forEach((p) => { listingToMarket[p.id] = p.market; });

  const { data: vendorMapData } = await supabase
    .from("vendor_map")
    .select("market, individual_name, company_name, excluded")
    .in("market", markets);

  const vendorLookup = {};
  for (const v of vendorMapData || []) {
    vendorLookup[`${v.market}:${v.individual_name}`] = v;
  }

  const results = {};

  for (const market of markets) {
    try {
      const bzProps = await fetchAllBzPropertiesForMarket(market);
      const properties = market === "branson"
        ? bzProps.filter((p) => {
            const guestyId = p.reference_external_property_id;
            return guestyId ? listingToMarket[guestyId] === "branson" : false;
          })
        : bzProps;

      let upserted = 0;
      let errors = 0;
      let maintenanceFetched = 0;
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
              const [cleanTasks, maintTasks] = await Promise.all([
                fetchBzTasksForProperty(bzId, propName, fromStr, toDate, market),
                fetchBzMaintenanceTasksForProperty(bzId, propName, fromStr, toDate, market).catch(() => []),
              ]);
              maintenanceFetched += maintTasks.length;
              const seen = new Set(cleanTasks.map((t) => String(t.id)));
              const newMaint = maintTasks.filter((t) => !seen.has(String(t.id)));
              return [...cleanTasks, ...newMaint];
            } catch (e) {
              if (!e.message.includes("422") && !e.message.includes("404")) errors++;
              return [];
            }
          })
        );
        allRows.push(...batchResults.flat());
      }

      // Detect individual → company
      const detectedCompany = {};
      for (const t of allRows) {
        const individual = t.finished_by?.name || t.assigned_to;
        if (!individual || isExcludedVendor(individual)) continue;
        const accepted = (t.assignments || []).find(
          (a) => a.type_task_user_status === "accepted" && a.name && a.name !== individual
        );
        if (accepted?.name) detectedCompany[individual] = accepted.name;
      }

      const rows = [];
      for (const t of allRows) {
        const createdBy = t.created_by?.name || t.created_by?.display_name ||
          (typeof t.created_by === "string" ? t.created_by : null);
        const taskType = t.type_department || t.task_type || t.type || null;
        const taskTitle = t.name || t.task_title || t.title || null;

        const vendorName = t.finished_by?.name || t.assigned_to || "Unassigned";
        const isMaintTask = (taskType || "").toLowerCase().includes("maintenance") ||
          (taskType || "").toLowerCase().includes("issue");
        // Keep maintenance tasks regardless of vendor — their creator is what matters
        if (!isMaintTask && isExcludedVendor(vendorName)) continue;

        rows.push({
          task_id:        String(t.id),
          market,
          property_name:  t._propName || null,
          bz_property_id: String(t.reference_property_id || t._bzId || ""),
          vendor_name:    vendorName,
          task_title:     taskTitle,
          task_type:      taskType,
          created_by:     createdBy,
          created_at:     t.created_at ? new Date(t.created_at).toISOString() : null,
          clean_status:   t.status || null,
          scheduled_date: t.scheduled_date || null,
          started_at:     t.started_at ? new Date(t.started_at).toISOString() : null,
          finished_at:    t.finished_at ? new Date(t.finished_at).toISOString() : null,
          total_time:     t.total_time || null,
          is_finished:    !!t.finished_at,
          assigned_count: t.assignments?.length || 0,
          pulled_at:      new Date().toISOString(),
          // Maintenance-task detail fields (already inline on the BZ task object)
          ...(isMaintTask && {
            description: t.description || null,
            summary:     t.summary?.note || null,
            comments:    t.comments?.length ? t.comments : null,
          }),
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

      // Sample of maintenance tasks found — for debugging
      const maintSample = allRows
        .filter((t) => {
          const type = (t.type_department || t.task_type || t.type || "").toLowerCase();
          return type.includes("maintenance") || type.includes("issue");
        })
        .slice(0, 5)
        .map((t) => ({
          id: t.id,
          type_department: t.type_department,
          task_type: t.task_type,
          type: t.type,
          name: t.name,
          task_title: t.task_title,
          created_by: t.created_by,
          scheduled_date: t.scheduled_date,
          created_at: t.created_at,
        }));

      // Raw field keys from first task — helps identify correct field names
      const firstTask = allRows[0];
      const rawKeys = firstTask ? Object.keys(firstTask).filter(k => !k.startsWith("_")) : [];

      results[market] = {
        properties_used: properties.length,
        tasks_fetched: allRows.length,
        maintenance_fetched: maintenanceFetched,
        upserted,
        property_errors: errors,
        raw_field_keys: rawKeys,
        maintenance_sample: maintSample,
      };
    } catch (err) {
      results[market] = { error: err.message };
    }
  }

  return Response.json({ ok: true, fromStr, toDate, results });
}
