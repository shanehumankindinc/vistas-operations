import { createHash } from "crypto";
import { getSupabase } from "@/lib/db";

export const dynamic = "force-dynamic";

const SAFE_COLS = "id, name, email, role, markets, created_at";

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ops_users")
    .select(SAFE_COLS)
    .order("name");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ users: data });
}

export async function POST(req) {
  const body = await req.json();
  const { name, email, role, markets, password } = body;
  if (!name || !email || !role) {
    return Response.json({ error: "name, email, and role are required" }, { status: 400 });
  }
  const supabase = getSupabase();
  const insert = {
    name,
    email: email.toLowerCase().trim(),
    role,
    markets: markets || [],
    ...(password ? { password_hash: sha256(password) } : {}),
  };
  const { data, error } = await supabase
    .from("ops_users")
    .insert(insert)
    .select(SAFE_COLS)
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ user: data });
}

export async function PATCH(req) {
  const body = await req.json();
  const { id, password, ...rest } = body;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const updates = {
    ...rest,
    ...(password ? { password_hash: sha256(password) } : {}),
  };
  // Never let password_hash leak out through this route
  delete updates.password_hash;
  if (password) updates.password_hash = sha256(password);

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ops_users")
    .update(updates)
    .eq("id", id)
    .select(SAFE_COLS)
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
