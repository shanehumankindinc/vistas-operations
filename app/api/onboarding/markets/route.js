import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/db";

export async function GET() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("markets")
    .select("id, name, display_name, company_name, city, state, region, attractions, custom_fields, has_guesty, has_breezeway")
    .order("sort_order");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ markets: data });
}
