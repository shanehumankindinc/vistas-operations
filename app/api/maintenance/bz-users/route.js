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

    // Try the company user endpoint first, fall back to v1 users
    const res = await fetch(`${BASE}/company/v1/user?limit=200`, {
      headers: { Authorization: `JWT ${token}`, Accept: "application/json" },
    });

    if (!res.ok) {
      // Try alternate endpoint
      const res2 = await fetch(`${BASE}/v1/user?limit=200`, {
        headers: { Authorization: `JWT ${token}`, Accept: "application/json" },
      });
      if (!res2.ok) {
        return Response.json({ users: [] });
      }
      const data2 = await res2.json();
      const users2 = normalizeUsers(data2);
      return Response.json({ users: users2 });
    }

    const data = await res.json();
    const users = normalizeUsers(data);
    return Response.json({ users });
  } catch (err) {
    console.error("bz-users error:", err);
    return Response.json({ users: [] });
  }
}

function normalizeUsers(data) {
  const rows = Array.isArray(data) ? data : (data.results || data.data || data.users || []);
  return rows
    .map(u => ({
      id: u.id || u.user_id,
      name: u.name || u.full_name || u.display_name || [u.first_name, u.last_name].filter(Boolean).join(" "),
    }))
    .filter(u => u.id && u.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}
