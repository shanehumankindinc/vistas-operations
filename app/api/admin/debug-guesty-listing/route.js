import { fetchAllListings } from "@/lib/guesty";

export const dynamic = "force-dynamic";

function getSessionUser(req) {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/ops_session=([^;]+)/);
  if (!match) return null;
  try {
    const [data] = match[1].split(".");
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch { return null; }
}

// Dump the raw Guesty listing object for a single property.
// Params: ?market=branson&listing_id=OPTIONAL_ID
export async function GET(req) {
  const session = getSessionUser(req);
  if (!session || session.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
  const { searchParams } = new URL(req.url);

  const market = searchParams.get("market") || "branson";
  const listingId = searchParams.get("listing_id");

  const listings = await fetchAllListings(market);
  const listing = listingId
    ? listings.find((l) => l._id === listingId)
    : listings[0];

  if (!listing) {
    return Response.json({ error: "Listing not found", count: listings.length }, { status: 404 });
  }

  return Response.json({
    listing_id: listing._id,
    nickname: listing.nickname,
    fields_present: Object.keys(listing),
    listing,
  });
}
