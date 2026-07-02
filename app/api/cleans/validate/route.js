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

const VALID_MARKETS = new Set(["branson", "deep_creek", "poconos", "all"]);

export async function GET(req) {
  const session = getSessionUser(req);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || "all";

  const supabase = getSupabase();
  let query = supabase.from("validated_cleans").select("task_id");
  if (market !== "all" && VALID_MARKETS.has(market)) {
    query = query.eq("market", market);
  }
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ task_ids: (data || []).map(r => r.task_id) });
}

export async function POST(req) {
  const session = getSessionUser(req);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { task_id, market } = body;
  if (!task_id) return Response.json({ error: "task_id required" }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase
    .from("validated_cleans")
    .upsert({ task_id, market: market || "unknown", validated_by: session.name || session.email || null, validated_at: new Date().toISOString() }, { onConflict: "task_id" });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(req) {
  const session = getSessionUser(req);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const task_id = searchParams.get("task_id");
  if (!task_id) return Response.json({ error: "task_id required" }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase.from("validated_cleans").delete().eq("task_id", task_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
