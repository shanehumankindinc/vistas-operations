import { getSupabase } from "../../../../lib/db";

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
    const supabase = getSupabase();
    // Employees: excluded=true AND company_name IS NULL (per CLAUDE.md people-picker rule)
    const { data, error } = await supabase
      .from("vendor_map")
      .select("individual_name, email")
      .eq("market", market)
      .eq("excluded", true)
      .is("company_name", null)
      .neq("individual_name", "Unassigned")
      .order("individual_name");

    if (error) throw error;

    const users = (data || []).map(r => ({
      id: r.individual_name,
      name: r.individual_name,
      email: r.email,
    }));

    return Response.json({ users });
  } catch (err) {
    console.error("bz-users error:", err);
    return Response.json({ users: [] });
  }
}
