"use client";

import { useEffect, useState, useCallback, useMemo } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

const MARKET_OPTIONS = [
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

// ─── Types ────────────────────────────────────────────────────────────────────

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
  enriched_tasks?: EnrichedTask[];
};

type Meta = {
  fromDate: string;
  toDate: string;
  lastSynced: string | null;
  taskCount: number;
  reviewCount: number;
};

type SortKey = "vendor_name" | "total_cleans" | "on_time_rate" | "cleanliness_score" |
  "review_count" | "median_time" | "tasks_overdue" | "refund_count" | "refund_amount" | "property_count";

// ─── Formatters ───────────────────────────────────────────────────────────────

function pct(n: number | null) {
  if (n == null) return "—";
  return (n * 100).toFixed(0) + "%";
}
function fmtScore(n: number | null, decimals = 2) {
  if (n == null) return "—";
  return n.toFixed(decimals);
}
function fmtTime(mins: number | null) {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtMoney(n: number) {
  if (!n) return "None";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateShort(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function parseTimeStr(s: string | null): number | null {
  if (!s) return null;
  const p = s.split(":").map(Number);
  if (p.length === 3) return p[0] * 60 + p[1] + p[2] / 60;
  if (p.length === 2) return p[0] * 60 + p[1];
  return null;
}

// ─── Colors ───────────────────────────────────────────────────────────────────

function rateColor(r: number | null) {
  if (r == null) return "#6b7280";
  if (r >= 0.9) return "#16a34a";
  if (r >= 0.75) return "#d97706";
  return "#dc2626";
}
function scoreColor(s: number | null) {
  if (s == null) return "#6b7280";
  if (s >= 4.7) return "#16a34a";
  if (s >= 4.3) return "#d97706";
  return "#dc2626";
}

// ─── NavSelect ────────────────────────────────────────────────────────────────

function NavSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { key: string; label: string }[];
}) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        background: "transparent", border: "none", color: "#ffffff", fontSize: 14,
        fontWeight: 500, cursor: "pointer", paddingRight: 20,
        appearance: "none", WebkitAppearance: "none", outline: "none", maxWidth: 200,
      }}>
        {options.map(o => <option key={o.key} value={o.key} style={{ background: "#0f172a", color: "#ffffff" }}>{o.label}</option>)}
      </select>
      <span style={{ color: "#64748b", fontSize: 10, pointerEvents: "none", marginLeft: -16 }}>▾</span>
    </div>
  );
}

// ─── Export helper ────────────────────────────────────────────────────────────

function exportCSV(cleaner: Row, meta: Meta | null) {
  const tasks = (cleaner.enriched_tasks || []).sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
  const headers = ["Sched Date", "Property", "Status", "Finished (CST)", "On Time?", "Deadline Type", "Deadline", "Duration (min)", "Cleanliness", "Review", "Refund?"];
  const csvRows = [headers, ...tasks.map(t => {
    const finishedStr = t.finished_cst ? `${t.finished_cst.dateStr} ${t.finished_cst.hour}:${String(t.finished_cst.minute).padStart(2, "0")} CST` : "";
    const refundAmt = t.linked_refunds.reduce((s, r) => s + r.refund_amount, 0);
    return [
      t.scheduled_date,
      t.property_name || "",
      !t.decided ? "Scheduled" : t.is_finished ? "Completed" : "Overdue",
      finishedStr,
      !t.decided ? "—" : t.on_time ? "Yes" : "No",
      t.deadline_type,
      t.deadline ? `4PM ${t.deadline}` : "",
      fmtTime(parseTimeStr(t.total_time)),
      t.review?.cleanliness != null ? t.review.cleanliness.toFixed(1) : "",
      ((t.review as { review_text?: string } | null)?.review_text || "").replace(/,/g, ";"),
      refundAmt > 0 ? `$${refundAmt}` : "",
    ];
  })];
  const csv = csvRows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${cleaner.vendor_name.replace(/\s+/g, "_")}_${meta?.fromDate || "export"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [market, setMarket] = useState("all");
  const [filterCleaner, setFilterCleaner] = useState("all");
  const [rangeDays, setRangeDays] = useState(90);
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("on_time_rate");
  const [sortAsc, setSortAsc] = useState(false);
  // Drill-down: null = summary view, Row = detail view for that cleaner
  const [drillCleaner, setDrillCleaner] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - rangeDays);
    try {
      const res = await fetch(`/api/data?market=${market}&from=${from.toISOString().slice(0, 10)}&to=${today.toISOString().slice(0, 10)}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setRows(json.scorecard || []);
      setMeta(json.meta || null);
      setFilterCleaner("all");
      setDrillCleaner(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [market, rangeDays]);

  useEffect(() => { load(); }, [load]);

  const cleanerOptions = useMemo(() => [
    { key: "all", label: "All Cleaners" },
    ...rows.map(r => ({ key: r.vendor_name, label: r.vendor_name })).sort((a, b) => a.label.localeCompare(b.label)),
  ], [rows]);

  // When cleaner dropdown changes, either clear drill-down or open it
  function handleCleanerSelect(name: string) {
    setFilterCleaner(name);
    if (name !== "all") {
      const row = rows.find(r => r.vendor_name === name) || null;
      setDrillCleaner(row);
    } else {
      setDrillCleaner(null);
    }
  }

  const visibleRows = useMemo(() => {
    const filtered = filterCleaner !== "all" ? rows.filter(r => r.vendor_name === filterCleaner) : rows;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? (sortAsc ? Infinity : -Infinity);
      const bv = b[sortKey] ?? (sortAsc ? Infinity : -Infinity);
      if (typeof av === "string" && typeof bv === "string") return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, filterCleaner, sortKey, sortAsc]);

  const kpiRows = filterCleaner !== "all" ? rows.filter(r => r.vendor_name === filterCleaner) : rows;
  const kpiOnTime = useMemo(() => { const s = kpiRows.filter(r => r.on_time_rate != null); return s.length ? s.reduce((a, r) => a + (r.on_time_rate ?? 0), 0) / s.length : null; }, [kpiRows]);
  const kpiCleanliness = useMemo(() => { const s = kpiRows.filter(r => r.cleanliness_score != null); return s.length ? s.reduce((a, r) => a + (r.cleanliness_score ?? 0), 0) / s.length : null; }, [kpiRows]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(false); }
  }

  const lastSyncedStr = meta?.lastSynced
    ? new Date(meta.lastSynced).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  // ─── Nav ──────────────────────────────────────────────────────────────────────

  const nav = (
    <nav style={{ background: "#0f172a", borderBottom: "1px solid #1e293b", padding: "0 24px", display: "flex", alignItems: "center", height: 52, gap: 0 }}>
      {drillCleaner ? (
        <button onClick={() => { setDrillCleaner(null); setFilterCleaner("all"); }} style={{
          padding: "4px 12px", border: "1px solid #334155", borderRadius: 6, background: "transparent",
          color: "#94a3b8", fontSize: 12, cursor: "pointer", marginRight: 20, display: "flex", alignItems: "center", gap: 6,
        }}>
          ← Back to Cleaners
        </button>
      ) : (
        <>
          <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 16, marginRight: 28, whiteSpace: "nowrap" }}>
            <span style={{ color: "#ffffff" }}>Vistas</span> Ops
          </span>
          <span style={{ width: 1, height: 20, background: "#1e293b", marginRight: 20, flexShrink: 0 }} />
          <NavSelect value={market} onChange={v => { setMarket(v); setFilterCleaner("all"); setDrillCleaner(null); }} options={MARKET_OPTIONS} />
          <span style={{ width: 1, height: 20, background: "#1e293b", margin: "0 20px", flexShrink: 0 }} />
          <NavSelect value={filterCleaner} onChange={handleCleanerSelect} options={cleanerOptions} />
        </>
      )}
      {drillCleaner && (
        <span style={{ fontWeight: 700, fontSize: 15, color: "#ffffff" }}>{drillCleaner.vendor_name}</span>
      )}
      <div style={{ flex: 1 }} />
      {drillCleaner && (
        <button onClick={() => exportCSV(drillCleaner, meta)} style={{
          padding: "5px 14px", border: "1px solid #16a34a", borderRadius: 6, background: "#16a34a",
          color: "#ffffff", fontSize: 12, fontWeight: 600, cursor: "pointer", marginRight: 8,
        }}>
          ↓ Export CSV
        </button>
      )}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {RANGES.map(r => (
          <button key={r.days} onClick={() => setRangeDays(r.days)} style={{
            padding: "4px 12px", border: "1px solid",
            borderColor: rangeDays === r.days ? "#ffffff" : "#334155",
            background: rangeDays === r.days ? "#ffffff" : "transparent",
            color: rangeDays === r.days ? "#0f172a" : "#64748b",
            borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}>{r.label}</button>
        ))}
        <button onClick={load} style={{ padding: "4px 10px", border: "1px solid #334155", borderRadius: 6, background: "transparent", color: "#64748b", fontSize: 13, cursor: "pointer", marginLeft: 4 }}>↻</button>
      </div>
    </nav>
  );

  // ─── Drill-down view ──────────────────────────────────────────────────────────

  if (drillCleaner) {
    const c = drillCleaner;
    const tasks = (c.enriched_tasks || []).sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
    const dateLabel = meta ? `${fmtDate(meta.fromDate)} → ${fmtDate(meta.toDate)}` : "";

    function Chip({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
      return (
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "10px 16px", minWidth: 90 }}>
          <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: color || "#ffffff" }}>{value}</div>
        </div>
      );
    }

    const totalRefundAmt = tasks.flatMap(t => t.linked_refunds).reduce((s, r) => s + r.refund_amount, 0);

    return (
      <div style={{ minHeight: "100vh", background: "#0d1117", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#e2e8f0" }}>
        {nav}
        <div style={{ maxWidth: 1500, margin: "0 auto", padding: "20px 24px" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#ffffff" }}>{c.vendor_name}</h2>
            <span style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "3px 10px", fontSize: 12, color: "#94a3b8" }}>{dateLabel}</span>
          </div>

          {/* KPI chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
            <Chip label="Cleans" value={c.total_cleans} />
            <Chip label="On-time Rate" value={pct(c.on_time_rate)} color={rateColor(c.on_time_rate)} />
            <Chip label="On-time / Cleans" value={`${c.on_time} / ${c.decided}`} />
            <Chip label="Tasks Overdue" value={c.tasks_overdue > 0 ? c.tasks_overdue : "None"} color={c.tasks_overdue > 0 ? "#dc2626" : "#16a34a"} />
            <Chip label="Properties" value={c.property_count} />
            <Chip label="Cleanliness" value={fmtScore(c.cleanliness_score)} color={scoreColor(c.cleanliness_score)} />
            <Chip label="Reviews" value={c.review_count || "None"} />
            <Chip label="Refund Exposure" value={fmtMoney(totalRefundAmt)} color={totalRefundAmt > 0 ? "#dc2626" : "#16a34a"} />
          </div>

          {/* Task table */}
          <div style={{ background: "#161b27", borderRadius: 10, border: "1px solid #1e2736", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e2736", fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Cleans &amp; Issues ({tasks.length}) — On-time rate applies to cleaning tasks only
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#0d1117" }}>
                    {["Sched Date", "Property", "Status", "Finished (Time)", "On Time?", "Check-In Deadline", "Time", "Cleanliness", "Review", "Refund?"].map(h => (
                      <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t, i) => {
                    const finishedStr = t.finished_cst
                      ? `${fmtDateShort(t.finished_cst.dateStr)} ${t.finished_cst.hour}:${String(t.finished_cst.minute).padStart(2, "0")} CST`
                      : null;
                    const statusColor = !t.decided ? "#64748b" : t.is_finished ? "#16a34a" : "#dc2626";
                    const statusLabel = !t.decided ? "Scheduled" : t.is_finished ? "Completed" : "Overdue";
                    const deadlineLabel = t.deadline
                      ? <span style={{ color: t.deadline_type === "same-day" ? "#f59e0b" : "#3b82f6" }}>
                          {t.deadline_type === "same-day" ? "Same-day" : `Next: ${t.deadline}`}
                        </span>
                      : <span style={{ color: "#475569" }}>—</span>;
                    const reviewText = (t.review as { review_text?: string } | null)?.review_text || null;
                    const refundAmt = t.linked_refunds.reduce((s, r) => s + r.refund_amount, 0);

                    return (
                      <tr key={t.task_id || i} style={{ borderBottom: "1px solid #1e2736" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#1e2736")}
                        onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "#94a3b8", fontWeight: 500 }}>{fmtDateShort(t.scheduled_date)}</td>
                        <td style={{ padding: "9px 12px", color: "#e2e8f0", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span title={t.property_name || undefined}>{t.property_name || "—"}</span>
                        </td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: statusColor, fontWeight: 500 }}>{statusLabel}</td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "#64748b" }}>{finishedStr || "—"}</td>
                        <td style={{ padding: "9px 12px", textAlign: "center" }}>
                          {!t.decided ? <span style={{ color: "#475569" }}>—</span>
                            : t.on_time ? <span style={{ color: "#16a34a", fontSize: 16 }}>✓</span>
                            : <span style={{ color: "#dc2626", fontSize: 16 }}>✗</span>}
                        </td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>{deadlineLabel}</td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "#64748b" }}>{fmtTime(parseTimeStr(t.total_time))}</td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: scoreColor(t.review?.cleanliness ?? null), fontWeight: t.review?.cleanliness != null ? 700 : 400 }}>
                          {t.review?.cleanliness != null ? t.review.cleanliness.toFixed(1) : "—"}
                        </td>
                        <td style={{ padding: "9px 12px", color: "#94a3b8", maxWidth: 300 }}>
                          {reviewText
                            ? <span title={reviewText} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reviewText}</span>
                            : <span style={{ color: "#475569" }}>—</span>}
                        </td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: refundAmt > 0 ? "#dc2626" : "#475569", fontWeight: refundAmt > 0 ? 700 : 400 }}>
                          {refundAmt > 0 ? `$${refundAmt}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {tasks.length === 0 && (
                    <tr><td colSpan={10} style={{ padding: "32px", textAlign: "center", color: "#475569" }}>No tasks in this range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Summary view ──────────────────────────────────────────────────────────────

  function Th({ k, label, right = true }: { k: SortKey; label: string; right?: boolean }) {
    const active = sortKey === k;
    return (
      <th onClick={() => handleSort(k)} style={{
        padding: "10px 14px", textAlign: right ? "right" : "left", fontSize: 10, fontWeight: 600,
        color: active ? "#ffffff" : "#64748b", letterSpacing: "0.06em", textTransform: "uppercase",
        cursor: "pointer", whiteSpace: "nowrap", userSelect: "none",
      }}>
        {label}{active ? (sortAsc ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {nav}
      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "20px 24px" }}>

        {/* KPI cards */}
        {!loading && kpiRows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 16 }}>
            {[
              { label: "Cleaners", value: kpiRows.length, render: (v: number) => v.toLocaleString() },
              { label: "Total Cleans", value: kpiRows.reduce((s, r) => s + r.total_cleans, 0), render: (v: number) => v.toLocaleString() },
              { label: "Avg On-time", value: kpiOnTime, render: (v: number | null) => pct(v), color: rateColor(kpiOnTime) },
              { label: "Avg Cleanliness", value: kpiCleanliness, render: (v: number | null) => v == null ? "—" : v.toFixed(2), color: scoreColor(kpiCleanliness) },
              { label: "Reviews", value: kpiRows.reduce((s, r) => s + r.review_count, 0), render: (v: number) => v.toLocaleString() },
              { label: "Properties", value: kpiRows.reduce((s, r) => s + r.property_count, 0), render: (v: number) => v.toLocaleString() },
            ].map(({ label, value, render, color }) => (
              <div key={label} style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 18px" }}>
                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <div style={{ fontSize: 22, fontWeight: 700, color: color || "#0f172a", lineHeight: 1 }}>{(render as (v: any) => string)(value)}</div>
              </div>
            ))}
          </div>
        )}

        {error && <div style={{ marginBottom: 16, padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#dc2626", fontSize: 13 }}>{error}</div>}

        <div style={{ background: "#ffffff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          {meta && !loading && (
            <div style={{ padding: "8px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 12, fontSize: 11, color: "#94a3b8", flexWrap: "wrap", alignItems: "center" }}>
              <span>{meta.fromDate} → {meta.toDate}</span>
              <span>·</span><span>{meta.taskCount.toLocaleString()} tasks</span>
              <span>·</span><span>{meta.reviewCount} reviews</span>
              {lastSyncedStr && <><span>·</span><span>Last synced {lastSyncedStr}</span></>}
              <span style={{ marginLeft: "auto", color: "#cbd5e1", fontSize: 10 }}>Click a row to drill down</span>
            </div>
          )}

          {loading && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0", color: "#94a3b8", fontSize: 14 }}>Loading…</div>}

          {!loading && rows.length === 0 && !error && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 0", gap: 8 }}>
              <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>No cleaner data for this range.</p>
              <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>Run the breezeway-tasks cron to populate data.</p>
            </div>
          )}

          {!loading && rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#0f172a" }}>
                    <Th k="vendor_name" label="Cleaner" right={false} />
                    <Th k="total_cleans" label="Cleans" />
                    <Th k="on_time_rate" label="On-time %" />
                    <Th k="cleanliness_score" label="Cleanliness" />
                    <Th k="review_count" label="Reviews" />
                    <Th k="median_time" label="Med. Time" />
                    <Th k="tasks_overdue" label="Overdue" />
                    <Th k="refund_count" label="Refund #" />
                    <Th k="refund_amount" label="Refund $" />
                    <Th k="property_count" label="Props" />
                    <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(row => (
                    <tr key={row.vendor_name}
                      onClick={() => { setDrillCleaner(row); setFilterCleaner(row.vendor_name); }}
                      style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ fontWeight: 600, color: "#0f172a" }}>{row.vendor_name}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{row.property_count} {row.property_count === 1 ? "property" : "properties"}</div>
                      </td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: "#374151", fontVariantNumeric: "tabular-nums" }}>{row.total_cleans}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: rateColor(row.on_time_rate), fontWeight: 600 }}>
                        {pct(row.on_time_rate)}
                        <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 11, marginLeft: 4 }}>{row.on_time}/{row.decided}</span>
                      </td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: scoreColor(row.cleanliness_score), fontWeight: row.cleanliness_score != null ? 600 : 400 }}>{fmtScore(row.cleanliness_score)}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: "#6b7280" }}>{row.review_count || "—"}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: "#6b7280" }}>{fmtTime(row.median_time)}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: row.tasks_overdue > 0 ? "#dc2626" : "#6b7280", fontWeight: row.tasks_overdue > 0 ? 600 : 400 }}>{row.tasks_overdue || "—"}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: row.refund_count > 0 ? "#dc2626" : "#6b7280", fontWeight: row.refund_count > 0 ? 600 : 400 }}>{row.refund_count || "—"}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: row.refund_amount > 0 ? "#dc2626" : "#6b7280", fontWeight: row.refund_amount > 0 ? 600 : 400 }}>{fmtMoney(row.refund_amount)}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: "#6b7280" }}>{row.property_count}</td>
                      <td style={{ padding: "12px 14px", textAlign: "center" }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: rateColor(row.on_time_rate), display: "inline-block" }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
