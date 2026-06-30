import { getSupabase } from "@/lib/db";
import { MARKET_KEYS } from "@/lib/markets";
import { computeScorecard } from "@/lib/scorecard-data";

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

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const marketParam = searchParams.get("market") || "all";
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  const fromDate = searchParams.get("from") || defaultFrom.toISOString().slice(0, 10);
  const toDate = searchParams.get("to") || today;

  // Vendor enforcement: lock market to their assigned market, filter scorecard to their company
  const sessionUser = getSessionUser(req);
  const isVendor = sessionUser?.role === "vendor";
  let markets = marketParam === "all" ? [...MARKET_KEYS] : [marketParam];
  let vendorCompanyFilter = null;

  if (isVendor) {
    const vendorMarket = (sessionUser.markets || [])[0];
    if (!vendorMarket) return Response.json({ error: "Forbidden" }, { status: 403 });
    markets = [vendorMarket];
    vendorCompanyFilter = sessionUser.vendor_company || null;
  }

  const supabase = getSupabase();

  // Cache check: only for non-vendor live-window requests
  const isLiveWindow = toDate === today;
  if (isLiveWindow && !isVendor) {
    const { data: cached } = await supabase
      .from("scorecard_cache")
      .select("payload, computed_at")
      .eq("market", marketParam)
      .eq("from_date", fromDate)
      .eq("to_date", toDate)
      .single();

    if (cached && cached.computed_at.slice(0, 10) === today) {
      return Response.json(cached.payload);
    }
  }

  let result;
  try {
    result = await computeScorecard({ markets, fromDate, toDate, supabase });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }

  // Write to cache for non-vendor live-window requests
  if (isLiveWindow && !isVendor) {
    supabase
      .from("scorecard_cache")
      .upsert(
        {
          market: marketParam,
          from_date: fromDate,
          to_date: toDate,
          computed_at: new Date().toISOString(),
          payload: result,
        },
        { onConflict: "market,from_date,to_date" }
      )
      .then(() => {});
  }

  // Apply vendor company filter — only their row is visible
  if (vendorCompanyFilter && result.scorecard) {
    result = { ...result, scorecard: result.scorecard.filter(r => r.vendor_name === vendorCompanyFilter) };
  }

  return Response.json(result);
}
