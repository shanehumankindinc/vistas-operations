import { createHash } from "crypto";
import { getSupabase } from "@/lib/db";

export const dynamic = "force-dynamic";

async function sendWelcomeEmail({ name, email, password }) {
  if (!process.env.MANDRILL_API_KEY || !password) return;
  try {
    await fetch("https://mandrillapp.com/api/1.0/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: process.env.MANDRILL_API_KEY,
        message: {
          from_email: "noreply@bransonvistas.com",
          from_name: "Vistas Operations",
          to: [{ email, name, type: "to" }],
          subject: "You've been added to Vistas Operations",
          html: `<p>Hi ${name},</p>
<p>You've been added to the <strong>Vistas Operations</strong> dashboard.</p>
<p>
  <strong>Login:</strong> <a href="https://vistas-operations.vercel.app/login">vistas-operations.vercel.app/login</a><br>
  <strong>Email:</strong> ${email}<br>
  <strong>Password:</strong> ${password}
</p>
<p style="color:#6b7280;font-size:12px;">Contact your admin if you need to change your password.</p>`,
          text: `Hi ${name},\n\nYou've been added to Vistas Operations.\n\nLogin: https://vistas-operations.vercel.app/login\nEmail: ${email}\nPassword: ${password}`,
        },
      }),
    });
  } catch { /* non-fatal — user is already created */ }
}

const SAFE_COLS = "id, name, email, role, markets, vendor_company, created_at";

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const supabase = getSupabase();

  // ?directory=true returns vendor_map people with emails for the Add User picker
  if (searchParams.get("directory") === "true") {
    const [{ data: vmPeople }, { data: existingUsers }] = await Promise.all([
      supabase.from("vendor_map").select("individual_name, email, company_name, market").not("email", "is", null).order("individual_name"),
      supabase.from("ops_users").select("email"),
    ]);
    const existingEmails = new Set((existingUsers || []).map(u => u.email.toLowerCase()));
    const directory = (vmPeople || []).map(p => ({
      ...p,
      already_user: existingEmails.has((p.email || "").toLowerCase()),
    }));
    return Response.json({ directory });
  }

  const { data, error } = await supabase
    .from("ops_users")
    .select(SAFE_COLS)
    .order("name");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ users: data });
}

export async function POST(req) {
  const body = await req.json();
  const { name, email, role, markets, vendor_company, password } = body;
  if (!name || !email || !role) {
    return Response.json({ error: "name, email, and role are required" }, { status: 400 });
  }
  const supabase = getSupabase();
  const insert = {
    name,
    email: email.toLowerCase().trim(),
    role,
    markets: markets || [],
    vendor_company: vendor_company || null,
    ...(password ? { password_hash: sha256(password) } : {}),
  };
  const { data, error } = await supabase
    .from("ops_users")
    .insert(insert)
    .select(SAFE_COLS)
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  sendWelcomeEmail({ name, email: insert.email, password });
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
