import { getSupabase } from "../../../lib/db";

function getSessionUser(req) {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/ops_session=([^;]+)/);
  if (!match) return null;
  try {
    const [data] = match[1].split(".");
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch { return null; }
}

export async function GET(req) {
  const session = getSessionUser(req);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "vendor") return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  // Validate date — must be within today through today+14
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 14);

  let targetDate = date;
  if (date) {
    const d = new Date(date + "T12:00:00Z");
    if (isNaN(d.getTime()) || d < today || d > maxDate) {
      return Response.json({ error: "Invalid date" }, { status: 400 });
    }
  }

  try {
    const supabase = getSupabase();
    const rpcArgs = targetDate ? { target_date: targetDate } : {};
    const { data, error } = await supabase.rpc("property_status", rpcArgs);
    if (error) throw error;
    return Response.json({ rows: data || [] });
  } catch (err) {
    console.error("maintenance API error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
