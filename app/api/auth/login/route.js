import { createHash, createHmac } from "crypto";
import { getSupabase } from "@/lib/db";

export const dynamic = "force-dynamic";

const AUTH_SECRET = process.env.AUTH_SECRET || "vistas-ops-dev-secret-2026";

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", AUTH_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export async function POST(req) {
  const { email, password } = await req.json();
  if (!email || !password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: user, error } = await supabase
    .from("ops_users")
    .select("id, name, email, role, markets, password_hash")
    .eq("email", email.toLowerCase().trim())
    .single();

  if (error || !user || user.password_hash !== sha256(password)) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const { password_hash: _, ...safeUser } = user;
  const token = signToken(safeUser);

  return new Response(JSON.stringify({ ok: true, user: safeUser }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `ops_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
    },
  });
}
