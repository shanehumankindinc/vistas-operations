import { fetchAllListings } from "@/lib/guesty";

export const dynamic = "force-dynamic";

// Dump the raw Guesty listing object for a single property.
// Auth: ?secret=CRON_SECRET
// Params: ?market=branson&listing_id=OPTIONAL_ID
// If listing_id is omitted, returns the first listing in the market.
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
