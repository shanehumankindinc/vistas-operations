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

// Resolves every unique finished_by person from recent tasks via the BZ People API.
// ?market=branson|deep_creek|poconos  (default: branson)
// ?days=30 (lookback window, default: 30)
export async function GET(req) {
  const session = getSessionUser(req);
  if (!session || session.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
  const { searchParams } = new URL(req.url);

  const market = searchParams.get("market") || "branson";
  const days = parseInt(searchParams.get("days") || "30", 10);

  const token = await getBzToken(market);
  const headers = { Authorization: `JWT ${token}`, Accept: "application/json" };
  const BASE = "https://api.breezeway.io/public";

  // --- Step 1: Get property IDs for this market from our DB ---
  const supabase = getSupabase();
  const { data: props } = await supabase
    .from("breezeway_tasks")
    .select("bz_property_id")
    .eq("market", market)
    .not("bz_property_id", "is", null)
    .limit(200);

  const propIds = [...new Set((props || []).map((p) => p.bz_property_id))];

  // --- Step 2: Fetch tasks across all properties in the lookback window ---
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = new Date().toISOString().slice(0, 10);

  const allTasks = [];
  for (const propId of propIds) {
    try {
      const res = await fetch(
        `${BASE}/inventory/v1/task?reference_property_id=${propId}&scheduled_date=${fromStr},${toStr}&limit=100`,
        { headers }
      );
      const body = await res.json().catch(() => null);
      const tasks = Array.isArray(body) ? body : (body?.results || body?.data || []);
      allTasks.push(...tasks);
    } catch { /* skip property on error */ }
  }

  // --- Step 3: Collect unique finished_by entries (id + name) ---
  // finished_by shape from BZ: { id: integer, name: string }
  const personMap = new Map(); // id -> { id, name, tasks: [] }
  for (const t of allTasks) {
    if (!t.finished_by?.id) continue;
    const pid = t.finished_by.id;
    if (!personMap.has(pid)) {
      personMap.set(pid, { id: pid, name: t.finished_by.name, tasks: [] });
    }
    // Attach a compact task summary for context
    personMap.get(pid).tasks.push({
      task_id: t.id,
      task_name: t.name,
      type_department: t.type_department,
      scheduled_date: t.scheduled_date,
      // The accepted assignment = vendor company name (crew member mapping)
      accepted_company: (t.assignments || []).find(
        (a) => a.type_task_user_status === "accepted" && a.name !== t.finished_by.name
      )?.name || null,
    });
  }

  // --- Step 4: Look up each unique person via the People API ---
  // Sequential with a small delay to be polite to the BZ rate limit.
  const personResults = [];
  for (const person of personMap.values()) {
    try {
      const res = await fetch(`${BASE}/inventory/v1/people/${person.id}`, { headers });
      const data = await res.json().catch(() => null);
      personResults.push({
        id: person.id,
        name: person.name,
        // Fields we care about from People API
        type_role: data?.type_role ?? null,
        type_departments: data?.type_departments ?? [],
        active: data?.active ?? null,
        emails: data?.emails ?? [],
        employee_code: data?.employee_code ?? null,
        // Derived from tasks
        task_count: person.tasks.length,
        // All distinct companies this person appears under (crew mapping check)
        companies: [...new Set(person.tasks.map((t) => t.accepted_company).filter(Boolean))],
        // Task type breakdown
        task_types: person.tasks.reduce((acc, t) => {
          const type = t.type_department || "unknown";
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        }, {}),
        // Raw API status in case lookup failed
        api_status: res.status,
      });
    } catch (err) {
      personResults.push({
        id: person.id,
        name: person.name,
        type_role: null,
        error: String(err),
        task_count: person.tasks.length,
        companies: [],
        task_types: {},
        api_status: null,
      });
    }
  }

  // --- Step 5: Summarize by type_role ---
  const byRole = personResults.reduce((acc, p) => {
    const role = p.type_role || "unknown";
    if (!acc[role]) acc[role] = [];
    acc[role].push({ name: p.name, companies: p.companies, task_types: p.task_types });
    return acc;
  }, {});

  // Flag: crew members are people who have an accepted_company != themselves
  // i.e. they finished tasks that were accepted by a different company name
  const crewMembers = personResults.filter((p) => p.companies.length > 0);
  const soloVendors = personResults.filter((p) => p.companies.length === 0);

  return Response.json({
    market,
    lookbackDays: days,
    propertiesChecked: propIds.length,
    tasksFound: allTasks.length,
    uniquePeopleFound: personResults.length,

    // The core result: does type_role differ between staff and vendors/crew?
    byRole,

    // Crew member check: people whose tasks were accepted by a company (not themselves)
    // These must still map correctly to their vendor company after any filtering we add.
    crewMembers: crewMembers.map((p) => ({
      name: p.name,
      type_role: p.type_role,
      companies: p.companies,
      task_types: p.task_types,
    })),

    // Solo vendor / unaffiliated people (no accepted company on their tasks)
    soloVendors: soloVendors.map((p) => ({
      name: p.name,
      type_role: p.type_role,
      task_types: p.task_types,
    })),

    // Full detail for debugging
    allPeople: personResults,
  });
}
