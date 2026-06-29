import { fetchReservationsByCheckIn } from "@/lib/guesty";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Dumps one raw reservation object to inspect all available fields.
// Auth: ?secret=CRON_SECRET&market=branson (default branson)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const market = searchParams.get("market") || "branson";
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const fromStr = from.toISOString().slice(0, 10);

  const reservations = await fetchReservationsByCheckIn(market, fromStr, today);
  const sample = reservations[0] || null;

  return Response.json({
    ok: true,
    total: reservations.length,
    root_keys: sample ? Object.keys(sample) : [],
    sample,
  });
}
