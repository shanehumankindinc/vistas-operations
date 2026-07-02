import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/db";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market");
  if (!market) return NextResponse.json({ error: "market required" }, { status: 400 });

  const sb = getSupabase();
  const { count, error } = await sb
    .from("zoho_submissions")
    .select("*", { count: "exact", head: true })
    .eq("market_id", market);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count });
}
