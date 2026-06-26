import { getBzToken } from "@/lib/breezeway";

export const dynamic = "force-dynamic";

// Debug: probe Breezeway for a users/vendors endpoint and return what we find.
// ?market=branson|deep_creek|poconos  (default: poconos)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || "poconos";

  try {
    const token = await getBzToken(market);
    const headers = { Authorization: `JWT ${token}`, Accept: "application/json" };

    // Try several candidate paths in parallel
    const candidates = [
      "/inventory/v1/user",
      "/inventory/v1/vendor",
      "/inventory/v1/service-provider",
      "/auth/v1/user",
    ];

    const results = await Promise.all(
      candidates.map(async (path) => {
        try {
          const res = await fetch(`https://api.breezeway.io/public${path}?limit=5`, { headers });
          const body = await res.json().catch(() => null);
          return { path, status: res.status, body };
        } catch (e) {
          return { path, status: "error", error: e.message };
        }
      })
    );

    return Response.json({ market, results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
