import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/db";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market");
  const id = searchParams.get("id");
  const search = (searchParams.get("search") || "").trim();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  // Single-record lookup by id (for reference panels)
  if (id) {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("zoho_submissions")
      .select("id, market_id, property_name, address, submitted_at, sheet_row, data")
      .eq("id", id)
      .single();
    if (error) return NextResponse.json({ submissions: [] });
    return NextResponse.json({ submissions: data ? [data] : [] });
  }

  if (!market) return NextResponse.json({ error: "market required" }, { status: 400 });

  const sb = getSupabase();
  let q = sb
    .from("zoho_submissions")
    .select("id, market_id, property_name, address, submitted_at, sheet_row, data", { count: "exact" })
    .eq("market_id", market)
    .order("submitted_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (search) {
    q = q.ilike("property_name", `%${search}%`);
  }

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ submissions: data || [], count: count ?? 0, page, limit });
}
