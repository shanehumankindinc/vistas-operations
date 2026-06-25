import { runMigrations } from "@/lib/db";

export const dynamic = "force-dynamic";

// Run once after deploy to create tables.
// Protect with CRON_SECRET so it can't be called accidentally.
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await runMigrations();
    return Response.json({ ok: true, message: "Migrations complete" });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
