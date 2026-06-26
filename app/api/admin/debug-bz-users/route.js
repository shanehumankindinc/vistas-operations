import { getBzToken } from "@/lib/breezeway";
import { MARKETS } from "@/lib/markets";

export const dynamic = "force-dynamic";

// Debug: inspect raw Breezeway task structure to find vendor/role fields.
// Also probes any remaining user-list endpoint candidates.
// ?market=branson|deep_creek|poconos  (default: poconos)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || "poconos";

  try {
    const token = await getBzToken(market);
    const headers = { Authorization: `JWT ${token}`, Accept: "application/json" };
    const BASE = "https://api.breezeway.io/public";
    const { bzIdentity } = MARKETS[market];

    // 1. Try identity-scoped user endpoints
    const userCandidates = [
      `/auth/v1/identity/${bzIdentity}/user`,
      `/auth/v1/identity/${bzIdentity}/member`,
      `/inventory/v1/identity/${bzIdentity}/user`,
      `/inventory/v1/identity/${bzIdentity}/vendor`,
      `/auth/v2/user`,
      `/auth/v2/member`,
    ];

    const userProbes = await Promise.all(
      userCandidates.map(async (path) => {
        try {
          const res = await fetch(`${BASE}${path}?limit=3`, { headers });
          const body = await res.json().catch(() => null);
          return { path, status: res.status, body };
        } catch (e) {
          return { path, status: "error", error: e.message };
        }
      })
    );

    // 2. Fetch one raw task and show all its fields (especially finished_by / assignments)
    const propRes = await fetch(`${BASE}/inventory/v1/property?limit=1`, { headers });
    const propData = await propRes.json();
    const props = Array.isArray(propData) ? propData : (propData.results || []);
    let rawTask = null;

    if (props.length > 0) {
      const bzId = props[0].reference_property_id;
      const today = new Date().toISOString().slice(0, 10);
      const from = new Date(); from.setDate(from.getDate() - 30);
      const fromStr = from.toISOString().slice(0, 10);
      const taskRes = await fetch(
        `${BASE}/inventory/v1/task?reference_property_id=${bzId}&scheduled_date=${fromStr},${today}&limit=1`,
        { headers }
      );
      const taskData = await taskRes.json();
      const tasks = Array.isArray(taskData) ? taskData : (taskData.results || taskData.data || []);
      rawTask = tasks[0] || null;
    }

    return Response.json({
      market,
      userProbes: userProbes.filter(p => p.status !== 404),
      rawTaskKeys: rawTask ? Object.keys(rawTask) : null,
      rawTask_finishedBy: rawTask?.finished_by ?? null,
      rawTask_assignedTo: rawTask?.assigned_to ?? null,
      rawTask_assignments: rawTask?.assignments ?? null,
      rawTask_vendor: rawTask?.vendor ?? null,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
