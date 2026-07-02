import { getBzToken } from "../../../../lib/breezeway";

function getSessionUser(req) {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/ops_session=([^;]+)/);
  if (!match) return null;
  try {
    const [data] = match[1].split(".");
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch { return null; }
}

const VALID_MARKETS = new Set(["branson", "deep_creek", "poconos"]);
const BASE = "https://api.breezeway.io/public";

export async function POST(req) {
  const session = getSessionUser(req);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "vendor") return Response.json({ error: "Forbidden" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { market, taskIds, assigneeId, scheduledDate } = body;

  if (!market || !VALID_MARKETS.has(market)) return Response.json({ error: "Invalid market" }, { status: 400 });
  if (!Array.isArray(taskIds) || taskIds.length === 0) return Response.json({ error: "No tasks provided" }, { status: 400 });
  if (!scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return Response.json({ error: "Invalid date" }, { status: 400 });

  try {
    const token = await getBzToken(market);

    const results = await Promise.allSettled(
      taskIds.map(async taskId => {
        const patch = {
          scheduled_date: scheduledDate,
          ...(assigneeId ? { assigned_to: assigneeId } : {}),
        };

        const res = await fetch(`${BASE}/inventory/v1/task/${encodeURIComponent(taskId)}`, {
          method: "PATCH",
          headers: {
            Authorization: `JWT ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(patch),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Task ${taskId}: ${res.status} ${body}`);
        }
        return taskId;
      })
    );

    const succeeded = results.filter(r => r.status === "fulfilled").map(r => r.value);
    const failed = results
      .filter(r => r.status === "rejected")
      .map(r => r.reason?.message || "Unknown error");

    if (failed.length > 0 && succeeded.length === 0) {
      return Response.json({ error: failed[0] || "All tasks failed to update" }, { status: 502 });
    }

    return Response.json({ ok: true, succeeded: succeeded.length, failed: failed.length, errors: failed });
  } catch (err) {
    console.error("schedule route error:", err);
    return Response.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
