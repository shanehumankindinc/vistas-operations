import { getBzToken } from "@/lib/breezeway";
import { getSupabase } from "@/lib/db";

export const dynamic = "force-dynamic";

function getSessionUser(req) {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/ops_session=([^;]+)/);
  if (!match) return null;
  try {
    const [data] = match[1].split(".");
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch { return null; }
}

// Debug: find cleaning tasks (not checklists) and inspect assignments vs finished_by
// to test the hypothesis: assignments[0] = company, finished_by = individual.
// ?market=branson|deep_creek|poconos  (default: poconos)
export async function GET(req) {
  const session = getSessionUser(req);
  if (!session || session.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || "poconos";

  const supabase = getSupabase();

  // Get several known property IDs from Supabase for this market
  const { data: props } = await supabase
    .from("breezeway_tasks")
    .select("bz_property_id")
    .eq("market", market)
    .not("bz_property_id", "is", null)
    .limit(20);

  const propIds = [...new Set((props || []).map((p) => p.bz_property_id))].slice(0, 5);

  const token = await getBzToken(market);
  const headers = { Authorization: `JWT ${token}`, Accept: "application/json" };
  const BASE = "https://api.breezeway.io/public";

  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(); from.setDate(from.getDate() - 90);
  const fromStr = from.toISOString().slice(0, 10);

  // Fetch tasks from several properties and find cleaning tasks with an individual finished_by
  const cleaningTasks = [];
  for (const propId of propIds) {
    if (cleaningTasks.length >= 5) break;
    try {
      const res = await fetch(
        `${BASE}/inventory/v1/task?reference_property_id=${propId}&scheduled_date=${fromStr},${today}&limit=20`,
        { headers }
      );
      const body = await res.json().catch(() => null);
      const tasks = Array.isArray(body) ? body : (body?.results || body?.data || []);

      // Keep tasks that have a finished_by individual AND assignments
      const relevant = tasks.filter(t =>
        t.finished_by?.name &&
        t.assignments?.length > 0 &&
        // Prefer cleaning tasks, not checklists
        !(t.name || "").toLowerCase().includes("checklist")
      );
      cleaningTasks.push(...relevant.slice(0, 3));
    } catch { /* skip */ }
  }

  return Response.json({
    market,
    propIds,
    cleaningTasksFound: cleaningTasks.length,
    // Show the key fields for each task
    tasks: cleaningTasks.map(t => ({
      id: t.id,
      name: t.name,
      type_department: t.type_department,
      scheduled_date: t.scheduled_date,
      finished_by: t.finished_by,
      assignments: t.assignments,
      assigned_to: t.assigned_to,
    })),
  });
}
