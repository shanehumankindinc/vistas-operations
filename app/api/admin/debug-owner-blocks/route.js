import { getGuestyToken } from "@/lib/guesty";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getSessionUser(req) {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/ops_session=([^;]+)/);
  if (!match) return null;
  try {
    const [data] = match[1].split(".");
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch { return null; }
}

// Probe what status values Guesty uses for owner blocks.
// ?market=branson
export async function GET(req) {
  const session = getSessionUser(req);
  if (!session || session.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
  const { searchParams } = new URL(req.url);

  const market = searchParams.get("market") || "branson";
  const token = await getGuestyToken(market);

  const today = new Date().toISOString().slice(0, 10);
  const future = new Date();
  future.setDate(future.getDate() + 60);
  const futureStr = future.toISOString().slice(0, 10);

  // Candidate status strings to probe — Guesty may use any of these for owner blocks
  const candidates = [
    "owner",
    "owner_hold",
    "blocked",
    "unavailable",
    "inquiry",
  ];

  const results = {};

  for (const status of candidates) {
    const url = new URL("https://open-api.guesty.com/v1/reservations");
    url.searchParams.set("limit", "3");
    url.searchParams.set("checkInDateFrom", today);
    url.searchParams.set("checkInDateTo", futureStr);
    url.searchParams.set("statuses", status);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      results[status] = { error: res.status, body: await res.text() };
      continue;
    }
    const data = await res.json();
    const samples = (data.results || []).slice(0, 2);
    results[status] = {
      count: data.count,
      samples: samples.map((r) => ({
        _id:              r._id,
        status:           r.status,
        source:           r.source,
        type:             r.type,
        checkIn:          r.checkIn,
        checkOut:         r.checkOut,
        listingId:        r.listingId,
        confirmationCode: r.confirmationCode,
        guestId:          r.guestId,
        root_keys:        Object.keys(r),
      })),
    };
  }

  // Also fetch the owners-reservations endpoint to see if owner blocks live there
  try {
    const ownerUrl = new URL("https://open-api.guesty.com/v1/owners-reservations");
    ownerUrl.searchParams.set("limit", "3");
    const ownerRes = await fetch(ownerUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (ownerRes.ok) {
      const ownerData = await ownerRes.json();
      const samples = (ownerData.results || ownerData.data || []).slice(0, 2);
      results["_owners_reservations_endpoint"] = {
        count: ownerData.count || ownerData.total,
        samples: samples.map((r) => ({
          _id:       r._id,
          status:    r.status,
          source:    r.source,
          checkIn:   r.checkIn || r.startDate,
          checkOut:  r.checkOut || r.endDate,
          listingId: r.listingId,
          root_keys: Object.keys(r),
        })),
      };
    } else {
      results["_owners_reservations_endpoint"] = { error: ownerRes.status };
    }
  } catch (e) {
    results["_owners_reservations_endpoint"] = { error: e.message };
  }

  return Response.json({ market, window: { from: today, to: futureStr }, results });
}
