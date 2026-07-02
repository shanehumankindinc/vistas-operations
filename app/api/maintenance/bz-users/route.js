import { getBzToken } from "../../../../lib/breezeway";

function getSessionUser(req) {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/ops_session=([^;]+)/);
  if (!match) return null;
  try {
    const [data] = match[1].split(".");
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch { return null; }
}

const VALID_MARKETS = new Set(["branson", "deep_creek", "poconos"]);
const BASE = "https://api.breezeway.io/public";

// Roles that are internal employees vs external vendors — same set used by the BZ sync cron
const INTERNAL_ROLES = new Set(["administrator", "supervisor", "office", "representative"]);

export async function GET(req) {
  const session = getSessionUser(req);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "vendor") return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market");
  if (!market || !VALID_MARKETS.has(market)) {
    return Response.json({ error: "Invalid market" }, { status: 400 });
  }

  try {
    const token = await getBzToken(market);
    const headers = { Authorization: `JWT ${token}`, Accept: "application/json" };

    const employees = [];
    let page = 1;

    while (true) {
      const res = await fetch(`${BASE}/inventory/v1/people?limit=100&page=${page}`, { headers });
      if (!res.ok) break;
      const body = await res.json().catch(() => null);
      const people = Array.isArray(body) ? body : (body?.results || body?.data || []);
      if (!people.length) break;

      for (const p of people) {
        const role = (p.type_role || "").toLowerCase();
        if (!INTERNAL_ROLES.has(role)) continue;
        const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
        if (!name || name.toLowerCase() === "unassigned") continue;
        employees.push({ id: p.id, name });
      }

      if (people.length < 100) break;
      page++;
    }

    employees.sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ users: employees });
  } catch (err) {
    console.error("bz-users error:", err);
    return Response.json({ users: [] });
  }
}
