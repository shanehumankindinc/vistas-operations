import { getSupabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ops_users")
    .select("*")
    .order("name");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ users: data });
}

export async function POST(req) {
  const body = await req.json();
  const { name, email, role, markets } = body;
  if (!name || !email || !role) {
    return Response.json({ error: "name, email, and role are required" }, { status: 400 });
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ops_users")
    .insert({ name, email, role, markets: markets || [] })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ user: data });
}

export async function PATCH(req) {
  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ops_users")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ user: data });
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const supabase = getSupabase();
  const { error } = await supabase.from("ops_users").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
