import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic";

// One-time bootstrap: fetches a fresh Breezeway token and caches it in KV.
// Protected by CRON_SECRET. Call once after deploy to seed the cache.
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch("https://api.breezeway.io/public/auth/v1/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.BREEZEWAY_CLIENT_ID,
      client_secret: process.env.BREEZEWAY_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return Response.json({ error: `Breezeway auth failed: ${res.status}`, detail: body }, { status: 502 });
  }

  const data = await res.json();
  const token = data.access_token;

  const kv = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  await kv.set("breezeway:access_token", token, { ex: 82800 });

  return Response.json({ ok: true, tokenLength: token.length });
}
