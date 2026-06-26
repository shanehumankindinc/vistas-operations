import { getBzToken } from "@/lib/breezeway";
import { getSupabase } from "@/lib/db";

export const dynamic = "force-dynamic";

// Debug: find a real raw Breezeway task to inspect vendor/company fields.
// ?market=branson|deep_creek|poconos  (default: poconos)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || "poconos";

  const supabase = getSupabase();

  // 1. What vendor names do we already have in Supabase for this market?
  const { data: vendors } = await supabase
    .from("breezeway_tasks")
    .select("vendor_name, bz_property_id")
    .eq("market", market)
    .not("vendor_name", "is", null)
    .limit(5);

  // 2. Try to fetch a raw task from Breezeway using a known bz_property_id from Supabase
  let rawTask = null;
  let apiError = null;

  try {
    const token = await getBzToken(market);
    const headers = { Authorization: `JWT ${token}`, Accept: "application/json" };
    const BASE = "https://api.breezeway.io/public";

    // Use a known property ID from our DB
    const knownPropId = vendors?.[0]?.bz_property_id;

    if (knownPropId) {
      const today = new Date().toISOString().slice(0, 10);
      const from = new Date(); from.setDate(from.getDate() - 90);
      const fromStr = from.toISOString().slice(0, 10);

      const res = await fetch(
        `${BASE}/inventory/v1/task?reference_property_id=${knownPropId}&scheduled_date=${fromStr},${today}&limit=3`,
        { headers }
      );
      const body = await res.json().catch(() => null);
      const tasks = Array.isArray(body) ? body : (body?.results || body?.data || []);

      // Pick first task that has a finished_by or assigned_to
      rawTask = tasks.find(t => t.finished_by || t.assigned_to) || tasks[0] || null;
    }
  } catch (e) {
    apiError = e.message;
  }

  return Response.json({
    market,
    supabase_vendors: vendors,
    apiError,
    rawTaskKeys: rawTask ? Object.keys(rawTask) : null,
    rawTask_finishedBy: rawTask?.finished_by ?? null,
    rawTask_assignedTo: rawTask?.assigned_to ?? null,
    rawTask_assignments: rawTask?.assignments ?? null,
    rawTask_full: rawTask,
  });
}
