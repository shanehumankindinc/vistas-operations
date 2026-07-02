import { createHash, createHmac } from "crypto";
import { getSupabase } from "@/lib/db";

export const dynamic = "force-dynamic";

const AUTH_SECRET = process.env.AUTH_SECRET || "";

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", AUTH_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export async function POST(req) {
  if (!AUTH_SECRET) return Response.json({ error: "Server misconfiguration: AUTH_SECRET not set" }, { status: 500 });
  const { email, password } = await req.json();
  if (!email || !password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: user, error } = await supabase
    .from("ops_users")
    .select("id, name, email, role, markets, vendor_company, password_hash")
    .eq("email", email.toLowerCase().trim())
    .single();

  if (error || !user || user.password_hash !== sha256(password)) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const { password_hash: _, ...safeUser } = user;
  const token = signToken(safeUser);

  const maxAge = 60 * 60 * 24 * 30;
  // ops_session: HttpOnly so JS cannot read the signed token
  // ops_ui: NOT HttpOnly so the client can read role/name for UI-only decisions (gear icon, etc.)
  const uiPayload = encodeURIComponent(JSON.stringify({ role: safeUser.role, name: safeUser.name }));
  return new Response(JSON.stringify({ ok: true, user: safeUser }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": [
        `ops_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
        `ops_ui=${uiPayload}; Path=/; SameSite=Lax; Max-Age=${maxAge}`,
      ].join(", "),
    },
  });
}
