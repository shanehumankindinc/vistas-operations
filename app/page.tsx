"use client";

import { useEffect, useState, useCallback } from "react";

const MARKETS = [
  { key: "all", label: "All Markets" },
  { key: "branson", label: "Branson / Ozarks" },
  { key: "deep_creek", label: "Deep Creek" },
  { key: "poconos", label: "Poconos" },
];

const RANGES = [
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
];

function pct(n: number | null) {
  if (n == null) return "—";
  return (n * 100).toFixed(0) + "%";
}

function fmt(n: number | null, decimals = 2) {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

function fmtTime(mins: number | null) {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type EnrichedTask = {
  task_id: string;
  scheduled_date: string;
  property_name: string | null;
  task_title: string | null;
  is_finished: boolean;
  finished_at: string | null;
  finished_cst: { dateStr: string; hour: number; minute: number } | null;
  clean_status: string | null;
  total_time: string | null;
  on_time: boolean;
  decided: boolean;
  deadline: string | null;
  deadline_type: "same-day" | "next-ci" | "none";
  review: { cleanliness: number | null; submitted_at: string; review_text?: string } | null;
  linked_refunds: { refund_amount: number; refund_reason: string }[];
};

type Row = {
  vendor_name: string;
  total_cleans: number;
  on_time: number;
  decided: number;
  on_time_rate: number | null;
  tasks_overdue: number;
  cleanliness_score: number | null;
  review_count: number;
  refund_count: number;
  refund_amount: number;
  property_count: number;
  median_time: number | null;
  properties?: string[];
  enriched_tasks?: EnrichedTask[];
};

type Meta = {
  fromDate: string;
  toDate: string;
  lastSynced: string | null;
  taskCount: number;
  reviewCount: number;
  markets: string[];
};

type SortKey = keyof Omit<Row, "properties" | "enriched_tasks">;

export default function Dashboard() {
  const [market, setMarket] = useState("all");
  const [rangeDays, setRangeDays] = useState(90);
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("on_time_rate");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedCleaner, setSelectedCleaner] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - rangeDays);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = today.toISOString().slice(0, 10);
    try {
      const res = await fetch(`/api/data?market=${market}&from=${fromStr}&to=${toStr}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setRows(json.scorecard || []);
      setMeta(json.meta || null);
      setSelectedCleaner(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [market, rangeDays]);

  useEffect(() => { load(); }, [load]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey] ?? (sortAsc ? Infinity : -Infinity);
    const bv = b[sortKey] ?? (sortAsc ? Infinity : -Infinity);
    if (typeof av === "string" && typeof bv === "string") {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  function statusDot(rate: number | null) {
    const color = rate == null ? "#6b7280" : rate >= 0.9 ? "#22c55e" : rate >= 0.75 ? "#f59e0b" : "#ef4444";
    return <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />;
  }

  function rateStyle(rate: number | null): React.CSSProperties {
    if (rate == null) return { color: "#6b7280" };
    if (rate >= 0.9) return { color: "#16a34a", fontWeight: 600 };
    if (rate >= 0.75) return { color: "#d97706", fontWeight: 600 };
    return { color: "#dc2626", fontWeight: 600 };
  }

  function scoreStyle(score: number | null): React.CSSProperties {
    if (score == null) return { color: "#6b7280" };
    if (score >= 4.7) return { color: "#16a34a", fontWeight: 600 };
    if (score >= 4.3) return { color: "#d97706", fontWeight: 600 };
    return { color: "#dc2626", fontWeight: 600 };
  }

  function Th({ k, label, right = true }: { k: SortKey; label: string; right?: boolean }) {
    const active = sortKey === k;
    return (
      <th onClick={() => handleSort(k)} style={{
        padding: "10px 14px", textAlign: right ? "right" : "left", fontSize: 11,
        fontWeight: 600, color: active ? "#ffffff" : "#94a3b8", letterSpacing: "0.06em",
        textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", background: "transparent",
      }}>
        {label}{active ? (sortAsc ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  const lastSyncedStr = meta?.lastSynced
    ? new Date(meta.lastSynced).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  const avgOnTime = rows.length > 0
    ? rows.filter(r => r.on_time_rate != null).reduce((s, r) => s + (r.on_time_rate ?? 0), 0) / rows.filter(r => r.on_time_rate != null).length
    : null;
  const avgScore = rows.filter(r => r.cleanliness_score != null);
  const avgScoreVal = avgScore.length > 0
    ? avgScore.reduce((s, r) => s + (r.cleanliness_score ?? 0), 0) / avgScore.length
    : null;

  const marketLabel = MARKETS.find(m => m.key === market)?.label || "All Markets";

  // ─── Nav ────────────────────────────────────────────────────────────
  const nav = (
    <nav style={{ background: "#0f172a", borderBottom: "1px solid #1e293b", padding: "0 24px", display: "flex", alignItems: "center", gap: 0, height: 48 }}>
      <span style={{ color: "#94a3b8", fontWeight: 600, fontSize: 15, marginRight: 20, letterSpacing: "-0.01em" }}>
        <span style={{ color: "#ffffff" }}>Vistas</span> Ops
      </span>

      {/* Market dropdown */}
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <select
          value={market}
          onChange={e => { setMarket(e.target.value); setSelectedCleaner(null); }}
          style={{
            background: "transparent", border: "none", color: "#ffffff", fontSize: 14,
            fontWeight: 500, cursor: "pointer", padding: "0 20px 0 0", appearance: "none",
            WebkitAppearance: "none", outline: "none",
          }}
        >
          {MARKETS.map(m => (
            <option key={m.key} value={m.key} style={{ background: "#0f172a", color: "#ffffff" }}>
              {m.label}
            </option>
          ))}
        </select>
        <span style={{ color: "#94a3b8", fontSize: 10, pointerEvents: "none", marginLeft: -16 }}>▾</span>
      </div>

      <div style={{ flex: 1 }} />

      {selectedCleaner && (
        <button onClick={() => setSelectedCleaner(null)} style={{
          padding: "4px 12px", border: "1px solid #334155", borderRadius: 6,
          background: "transparent", color: "#94a3b8", fontSize: 12, cursor: "pointer", marginRight: 8,
        }}>
          ← All Cleaners
        </button>
      )}

      <div style={{ display: "flex", gap: 4 }}>
        {RANGES.map(r => (
          <button key={r.days} onClick={() => setRangeDays(r.days)} style={{
            padding: "4px 12px", border: "1px solid", borderRadius: 6,
            borderColor: rangeDays === r.days ? "#ffffff" : "#334155",
            background: rangeDays === r.days ? "#ffffff" : "transparent",
            color: rangeDays === r.days ? "#0f172a" : "#64748b",
            fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}>
            {r.label}
          </button>
        ))}
        <button onClick={load} style={{ padding: "4px 10px", border: "1px solid #334155", borderRadius: 6, background: "transparent", color: "#64748b", fontSize: 12, cursor: "pointer", marginLeft: 4 }}>
          ↻
        </button>
      </div>
    </nav>
  );

  // ─── Cleaner detail view ─────────────────────────────────────────────
  if (selectedCleaner) {
    const c = selectedCleaner;
    const tasks = (c.enriched_tasks || []).sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));

    function chip(label: string, value: React.ReactNode, highlight?: string) {
      return (
        <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 16px", minWidth: 90 }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: highlight || "#0f172a" }}>{value}</div>
        </div>
      );
    }

    const rateHighlight = c.on_time_rate == null ? undefined : c.on_time_rate >= 0.9 ? "#16a34a" : c.on_time_rate >= 0.75 ? "#d97706" : "#dc2626";
    const scoreHighlight = c.cleanliness_score == null ? undefined : c.cleanliness_score >= 4.7 ? "#16a34a" : c.cleanliness_score >= 4.3 ? "#d97706" : "#dc2626";

    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {nav}
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 24px" }}>
          {/* Header */}
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>{c.vendor_name}</h2>
            {meta && <div style={{ fontSize: 12, color: "#94a3b8" }}>{meta.fromDate} → {meta.toDate} · {marketLabel}</div>}
          </div>

          {/* KPI chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
            {chip("Cleans", c.total_cleans)}
            {chip("On-time rate", pct(c.on_time_rate), rateHighlight)}
            {chip("On-time / cleans", `${c.on_time}/${c.decided}`)}
            {chip("Overdue", c.tasks_overdue > 0 ? c.tasks_overdue : "—", c.tasks_overdue > 0 ? "#dc2626" : undefined)}
            {chip("Properties", c.property_count)}
            {chip("Cleanliness", fmt(c.cleanliness_score), scoreHighlight)}
            {chip("Reviews", c.review_count || "—")}
            {chip("Refunds", c.refund_count > 0 ? c.refund_count : "None", c.refund_count > 0 ? "#dc2626" : "#16a34a")}
            {chip("Median time", fmtTime(c.median_time))}
          </div>

          {/* Tasks table */}
          <div style={{ background: "#ffffff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", fontSize: 12, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Cleans ({tasks.length})
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#0f172a" }}>
                    {["Sched Date", "Property", "Status", "Finished", "On Time?", "Deadline", "Time", "Cleanliness", "Review"].map(h => (
                      <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t, i) => {
                    const finishedStr = t.finished_cst
                      ? `${fmtDate(t.finished_cst.dateStr)} ${t.finished_cst.hour}:${String(t.finished_cst.minute).padStart(2, "0")} CST`
                      : null;

                    const statusColor = !t.is_finished
                      ? "#6b7280"
                      : t.on_time
                      ? "#16a34a"
                      : "#dc2626";

                    const statusLabel = !t.decided
                      ? "Scheduled"
                      : t.is_finished
                      ? "Completed"
                      : "Overdue";

                    const deadlineStyle: React.CSSProperties = t.deadline_type === "same-day"
                      ? { color: "#d97706", fontWeight: 500 }
                      : t.deadline_type === "next-ci"
                      ? { color: "#3b82f6", fontWeight: 500 }
                      : { color: "#94a3b8" };

                    const deadlineLabel = t.deadline
                      ? (t.deadline_type === "same-day" ? `Same-day ${fmtDate(t.deadline)}` : `Next: ${fmtDate(t.deadline)}`)
                      : "—";

                    const review = t.review;
                    const reviewText = (review as { review_text?: string } | null)?.review_text || null;

                    return (
                      <tr key={t.task_id || i} style={{ borderBottom: "1px solid #f1f5f9", background: "#ffffff" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                        onMouseLeave={e => (e.currentTarget.style.background = "#ffffff")}>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "#374151", fontWeight: 500 }}>
                          {fmtDate(t.scheduled_date)}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#374151", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.property_name || "—"}
                        </td>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                          <span style={{ color: statusColor, fontWeight: 500 }}>{statusLabel}</span>
                        </td>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "#6b7280" }}>
                          {finishedStr || "—"}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          {!t.decided ? (
                            <span style={{ color: "#94a3b8" }}>—</span>
                          ) : t.on_time ? (
                            <span style={{ color: "#16a34a", fontWeight: 700 }}>✓</span>
                          ) : (
                            <span style={{ color: "#dc2626", fontWeight: 700 }}>✗</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap", ...deadlineStyle }}>
                          {deadlineLabel}
                        </td>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "#6b7280" }}>
                          {t.total_time ? fmtTime(parseTimeStr(t.total_time)) : "—"}
                        </td>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap", ...(review?.cleanliness != null ? scoreStyle(review.cleanliness) : { color: "#94a3b8" }) }}>
                          {review?.cleanliness != null ? review.cleanliness.toFixed(1) : "—"}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#6b7280", maxWidth: 300 }}>
                          {reviewText ? (
                            <span title={reviewText} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {reviewText}
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main scorecard view ─────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {nav}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px" }}>
        {/* KPI cards */}
        {!loading && rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Cleaners", value: rows.length, fmt: (v: number) => String(v) },
              { label: "Total Cleans", value: rows.reduce((s, r) => s + r.total_cleans, 0), fmt: (v: number) => v.toLocaleString() },
              { label: "Avg On-time", value: avgOnTime, fmt: (v: number | null) => pct(v) },
              { label: "Avg Cleanliness", value: avgScoreVal, fmt: (v: number | null) => v == null ? "—" : v.toFixed(2) },
              { label: "Total Reviews", value: rows.reduce((s, r) => s + r.review_count, 0), fmt: (v: number) => String(v) },
              { label: "Properties", value: rows.reduce((s, r) => s + r.property_count, 0), fmt: (v: number) => String(v) },
            ].map(({ label, value, fmt: fmtFn }) => (
              <div key={label} style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 18px" }}>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <div style={{ fontSize: 24, fontWeight: 600, color: "#0f172a", lineHeight: 1 }}>{(fmtFn as (v: any) => string)(value)}</div>
              </div>
            ))}
          </div>
        )}

        {meta && !loading && (
          <div style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 12, color: "#94a3b8", flexWrap: "wrap", alignItems: "center" }}>
            <span>Unit data scraped {meta.fromDate} → {meta.toDate}</span>
            <span>·</span>
            <span>{meta.taskCount.toLocaleString()} tasks</span>
            <span>·</span>
            <span>{meta.reviewCount} reviews</span>
            {lastSyncedStr && <><span>·</span><span>Last synced {lastSyncedStr}</span></>}
          </div>
        )}

        {error && (
          <div style={{ marginBottom: 16, padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#dc2626", fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0", color: "#94a3b8", fontSize: 14 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 8 }}>
            <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>No cleaner data for this range.</p>
            <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>Run the breezeway-tasks cron to populate data.</p>
          </div>
        ) : (
          <div style={{ background: "#ffffff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#0f172a" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Unit</th>
                    <Th k="total_cleans" label="Cleans" />
                    <Th k="on_time_rate" label="On-time %" />
                    <Th k="cleanliness_score" label="Cleanliness" />
                    <Th k="review_count" label="Reviews" />
                    <Th k="median_time" label="Median time" />
                    <Th k="tasks_overdue" label="Overdue" />
                    <Th k="refund_count" label="Refunds" />
                    <Th k="property_count" label="Props" />
                    <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => (
                    <tr
                      key={row.vendor_name}
                      onClick={() => setSelectedCleaner(row)}
                      style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: "#ffffff" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={e => (e.currentTarget.style.background = "#ffffff")}
                    >
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ fontWeight: 600, color: "#0f172a", fontSize: 13 }}>{row.vendor_name}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{row.property_count} {row.property_count === 1 ? "property" : "properties"}</div>
                      </td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: "#374151", fontVariantNumeric: "tabular-nums" }}>{row.total_cleans}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", ...rateStyle(row.on_time_rate) }}>
                        {pct(row.on_time_rate)}
                        <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 11, marginLeft: 4 }}>{row.on_time}/{row.decided}</span>
                      </td>
                      <td style={{ padding: "12px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", ...scoreStyle(row.cleanliness_score) }}>{fmt(row.cleanliness_score)}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: "#6b7280" }}>{row.review_count || "—"}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: "#6b7280" }}>{fmtTime(row.median_time)}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: row.tasks_overdue > 0 ? "#dc2626" : "#6b7280", fontWeight: row.tasks_overdue > 0 ? 600 : 400 }}>{row.tasks_overdue || "—"}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: row.refund_count > 0 ? "#dc2626" : "#6b7280", fontWeight: row.refund_count > 0 ? 600 : 400 }}>{row.refund_count || "—"}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: "#6b7280" }}>{row.property_count}</td>
                      <td style={{ padding: "12px 14px", textAlign: "center" }}>{statusDot(row.on_time_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function parseTimeStr(s: string | null): number | null {
  if (!s) return null;
  const parts = s.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}
