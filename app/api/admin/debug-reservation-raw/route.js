import { getGuestyToken } from "@/lib/guesty";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Dumps one raw reservation object (no field filtering) to inspect all available fields.
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

  const token = await getGuestyToken(market);
  const url = new URL("https://open-api.guesty.com/v1/reservations");
  url.searchParams.set("limit", "1");
  url.searchParams.set("checkInDateFrom", fromStr);
  url.searchParams.set("checkInDateTo", today);
  url.searchParams.set("statuses", "confirmed,checked_in,checked_out,closed");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const sample = (data.results || [])[0] || null;

  return Response.json({
    ok: true,
    total: data.count,
    root_keys: sample ? Object.keys(sample) : [],
    sample,
  });
}
