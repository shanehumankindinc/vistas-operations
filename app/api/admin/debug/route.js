import { Redis } from "@upstash/redis";
import { MARKETS } from "@/lib/markets";

export const dynamic = "force-dynamic";

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && secret !== process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const out = {};

  // --- Guesty custom field definitions via Open API for DC and Poconos ---
  // Uses /v1/accounts/{accountId}/custom-fields with the cached KV token
  for (const market of ["deep_creek", "poconos"]) {
    try {
      const token = await kv.get(MARKETS[market].kvKey);
      if (!token) throw new Error(`No Guesty token in KV for ${market}`);

      const accountId = MARKETS[market].guestyAccountId;

      // First confirm which account this token belongs to
      const meRes = await fetch("https://open-api.guesty.com/v1/accounts/me", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const meData = await meRes.json();

      // Fetch field definitions for this account
      const cfRes = await fetch(`https://open-api.guesty.com/v1/accounts/${accountId}/custom-fields`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const cfData = await cfRes.json();
      const defs = Array.isArray(cfData) ? cfData : (cfData?.data || cfData?.customFields || cfData?.results || []);

      const feedbackField = defs.find(f =>
        (f.templateName || f.name || f.key || f.displayName || "").toLowerCase().includes("cleaner") ||
        (f.templateName || "").includes("gs_cleaner")
      );

      out[`guesty_fields_${market}`] = {
        me_status: meRes.status,
        me_account_id: meData._id || meData.id,
        cf_status: cfRes.status,
        total_fields: defs.length,
        all_fields: defs.map(f => ({
          id: f._id || f.id,
          fieldId: f.fieldId,
          name: f.displayName || f.name || f.templateName || f.key,
          templateName: f.templateName,
          type: f.fieldType || f.type,
        })),
        cleaner_feedback_field: feedbackField || null,
      };
    } catch (e) {
      out[`guesty_fields_${market}`] = { error: e.message };
    }
  }

  return Response.json(out);
}
