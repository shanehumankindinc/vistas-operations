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

// Debug: find maintenance/issue tasks created by cleaners in Breezeway.
// ?market=branson|deep_creek|poconos  (default: branson)
export async function GET(req) {
  const session = getSessionUser(req);
  if (!session || session.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || "branson";

  const supabase = getSupabase();

  // Get several known property IDs from Supabase for this market
  const { data: props } = await supabase
    .from("breezeway_tasks")
    .select("bz_property_id")
    .eq("market", market)
    .not("bz_property_id", "is", null)
    .limit(30);

  const propIds = [...new Set((props || []).map((p) => p.bz_property_id))].slice(0, 10);

  const token = await getBzToken(market);
  const headers = { Authorization: `JWT ${token}`, Accept: "application/json" };
  const BASE = "https://api.breezeway.io/public";

  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(); from.setDate(from.getDate() - 90);
  const fromStr = from.toISOString().slice(0, 10);

  const allTasks = [];
  const maintenanceTasks = [];
  const rawSample = [];

  for (const propId of propIds) {
    if (maintenanceTasks.length >= 5) break;
    try {
      const res = await fetch(
        `${BASE}/inventory/v1/task?reference_property_id=${propId}&scheduled_date=${fromStr},${today}&limit=50`,
        { headers }
      );
      const body = await res.json().catch(() => null);
      const tasks = Array.isArray(body) ? body : (body?.results || body?.data || []);

      // Capture a raw sample from the first property for field inspection
      if (rawSample.length === 0 && tasks.length > 0) {
        rawSample.push(...tasks.slice(0, 2));
      }

      allTasks.push(...tasks);

      // Find anything that looks like a maintenance or issue task
      const maint = tasks.filter(t => {
        const name = (t.name || t.task_title || t.title || "").toLowerCase();
        const type = (t.type_department || t.task_type || t.type || t.category || "").toLowerCase();
        return (
          type.includes("maintenance") ||
          type.includes("issue") ||
          type.includes("repair") ||
          name.includes("maintenance") ||
          name.includes("issue") ||
          name.includes("repair") ||
          name.includes("damage")
        );
      });
      maintenanceTasks.push(...maint);
    } catch { /* skip */ }
  }

  // Also try fetching without scheduled_date to see if maintenance tasks appear
  let noDateTasks = [];
  if (propIds.length > 0) {
    try {
      const res = await fetch(
        `${BASE}/inventory/v1/task?reference_property_id=${propIds[0]}&limit=20`,
        { headers }
      );
      const body = await res.json().catch(() => null);
      noDateTasks = Array.isArray(body) ? body : (body?.results || body?.data || []);
    } catch { /* skip */ }
  }

  return Response.json({
    market,
    propIdsChecked: propIds.length,
    totalTasksFetched: allTasks.length,
    maintenanceTasksFound: maintenanceTasks.length,

    // Raw field names from a sample clean task — look for type/title/created_by fields
    sampleCleanTaskKeys: rawSample[0] ? Object.keys(rawSample[0]) : [],
    sampleCleanTask: rawSample[0] || null,

    // Maintenance tasks found via scheduled_date query
    maintenanceTasks: maintenanceTasks.slice(0, 5).map(t => ({
      id: t.id,
      // All possible name/title fields
      name: t.name,
      title: t.title,
      task_title: t.task_title,
      // All possible type fields
      type: t.type,
      type_department: t.type_department,
      task_type: t.task_type,
      category: t.category,
      // Creator info
      created_by: t.created_by,
      created_at: t.created_at,
      reported_by: t.reported_by,
      // Dates
      scheduled_date: t.scheduled_date,
      due_date: t.due_date,
      // Status
      status: t.status,
      finished_by: t.finished_by,
      assigned_to: t.assigned_to,
    })),

    // Tasks fetched WITHOUT scheduled_date filter (may reveal different task types)
    noDateSample: {
      count: noDateTasks.length,
      typeBreakdown: noDateTasks.reduce((acc, t) => {
        const type = t.type_department || t.task_type || t.type || t.category || "unknown";
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {}),
      sample: noDateTasks.slice(0, 2).map(t => ({
        id: t.id,
        name: t.name, title: t.title, task_title: t.task_title,
        type: t.type, type_department: t.type_department, task_type: t.task_type,
        category: t.category, created_by: t.created_by, scheduled_date: t.scheduled_date,
      })),
    },
  });
}
