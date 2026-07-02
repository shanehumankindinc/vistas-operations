import { getBzToken } from "../../../../lib/breezeway";

const BASE = "https://api.breezeway.io/public";
const TASK_ID = "155495979";
const MARKET = "deep_creek";

export async function GET(req) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log = [];

  try {
    const token = await getBzToken(MARKET);
    log.push("Got BZ token OK");

    const headers = { Authorization: `JWT ${token}`, Accept: "application/json" };

    // 1. Fetch current task state
    const getRes = await fetch(`${BASE}/inventory/v1/task/${TASK_ID}`, { headers });
    const taskBefore = await getRes.json().catch(() => null);
    log.push({ step: "GET task before", status: getRes.status, task: taskBefore });

    // 2. Fetch people to find Rich
    const peopleRes = await fetch(`${BASE}/inventory/v1/people?limit=100&page=1`, { headers });
    const peopleBody = await peopleRes.json().catch(() => null);
    const people = Array.isArray(peopleBody) ? peopleBody : (peopleBody?.results || peopleBody?.data || []);
    log.push({ step: "GET people", status: peopleRes.status, count: people.length, sample: people.slice(0, 5).map(p => ({ id: p.id, name: [p.first_name, p.last_name].join(" "), role: p.type_role })) });

    const rich = people.find(p => {
      const name = [p.first_name, p.last_name].join(" ").toLowerCase();
      return name.includes("richard") || name.includes("bryson") || name.includes("rich");
    });
    log.push({ step: "Found Rich", person: rich ? { id: rich.id, name: [rich.first_name, rich.last_name].join(" "), role: rich.type_role } : null });

    if (!rich) {
      return Response.json({ ok: false, log, error: "Rich not found in BZ people list" });
    }

    // 3. Attempt PATCH with assigned_to as number
    const patchBody = { scheduled_date: "2026-07-02", assigned_to: rich.id };
    log.push({ step: "PATCH body", body: patchBody });

    const patchRes = await fetch(`${BASE}/inventory/v1/task/${TASK_ID}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    });
    const patchText = await patchRes.text();
    log.push({ step: "PATCH response", status: patchRes.status, body: patchText.slice(0, 1000) });

    // 4. Try PATCH with assignments array (matches the field name on the task object)
    for (const tryBody of [
      { assignments: [{ user_id: rich.id }] },
      { assignments: [rich.id] },
      { assignees: [{ user_id: rich.id }] },
      { user_ids: [rich.id] },
    ]) {
      const r = await fetch(`${BASE}/inventory/v1/task/${TASK_ID}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(tryBody),
      });
      const t = await r.text();
      log.push({ step: `PATCH ${JSON.stringify(tryBody)}`, status: r.status, body: t.slice(0, 300) });
    }

    // 5. Also try POST to people endpoint with task reference
    const peopleAssignRes = await fetch(`${BASE}/inventory/v1/people/${rich.id}/task`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: Number(TASK_ID) }),
    });
    const peopleAssignText = await peopleAssignRes.text();
    log.push({ step: "POST /people/{id}/task", status: peopleAssignRes.status, body: peopleAssignText.slice(0, 300) });

    // 6. Re-fetch task to see what changed
    const getRes2 = await fetch(`${BASE}/inventory/v1/task/${TASK_ID}`, { headers });
    const taskAfter = await getRes2.json().catch(() => null);
    log.push({ step: "GET task after", status: getRes2.status, assignments: taskAfter?.assignments });

    return Response.json({ ok: true, log });
  } catch (err) {
    return Response.json({ ok: false, log, error: err.message }, { status: 500 });
  }
}
