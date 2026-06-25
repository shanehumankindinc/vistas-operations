"use client";

import { useEffect, useState, useCallback, useMemo } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────

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

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Formatters ──────────────────────────────────────────────────────────────

function pct(n: number | null) {
  if (n == null) return "—";
  return (n * 100).toFixed(0) + "%";
}

function fmtScore(n: number | null) {
  if (n == null) return "—";
  return n.toFixed(2);
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

function parseTimeStr(s: string | null): number | null {
  if (!s) return null;
  const parts = s.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

// ─── Style helpers ───────────────────────────────────────────────────────────

function rateColor(rate: number | null) {
  if (rate == null) return "#6b7280";
  if (rate >= 0.9) return "#16a34a";
  if (rate >= 0.75) return "#d97706";
  return "#dc2626";
}

function scoreColor(score: number | null) {
  if (score == null) return "#6b7280";
  if (score >= 4.7) return "#16a34a";
  if (score >= 4.3) return "#d97706";
  return "#dc2626";
}

// ─── Select component ────────────────────────────────────────────────────────

function NavSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { key: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          background: "transparent",
          border: "none",
          color: "#ffffff",
          fontSize: 14,
          fontWeight: 500,
          cursor: "pointer",
          paddingRight: 20,
          appearance: "none",
          WebkitAppearance: "none",
          outline: "none",
          maxWidth: 180,
        }}
      >
        {placeholder && <option value="" style={{ background: "#0f172a" }}>{placeholder}</option>}
        {options.map(o => (
          <option key={o.key} value={o.key} style={{ background: "#0f172a", color: "#ffffff" }}>
            {o.label}
          </option>
        ))}
      </select>
      <span style={{ color: "#64748b", fontSize: 10, pointerEvents: "none", marginLeft: -16 }}>▾</span>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function Dashboard() {
  const [market, setMarket] = useState("all");
  const [selectedCleaner, setSelectedCleaner] = useState("all");
  const [rangeDays, setRangeDays] = useState(90);
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("on_time_rate");
  const [sortAsc, setSortAsc] = useState(false);

  // Fetch data whenever market or range changes
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
      setSelectedCleaner("all"); // reset cleaner on market change
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [market, rangeDays]);

  useEffect(() => { load(); }, [load]);

  // Cleaner options for dropdown
  const cleanerOptions = useMemo(() => [
    { key: "all", label: "All Cleaners" },
    ...rows.map(r => ({ key: r.vendor_name, label: r.vendor_name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ], [rows]);

  // Active cleaner row (when one is selected)
  const activeCleanerRow = useMemo(
    () => selectedCleaner !== "all" ? rows.find(r => r.vendor_name === selectedCleaner) ?? null : null,
    [rows, selectedCleaner]
  );

  // Rows visible in the summary table (all, or just the selected cleaner)
  const visibleRows = useMemo(() => {
    const filtered = selectedCleaner !== "all"
      ? rows.filter(r => r.vendor_name === selectedCleaner)
      : rows;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? (sortAsc ? Infinity : -Infinity);
      const bv = b[sortKey] ?? (sortAsc ? Infinity : -Infinity);
      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, selectedCleaner, sortKey, sortAsc]);

  // KPI source — when a cleaner is selected, cards reflect only that cleaner
  const kpiRows = useMemo(
    () => selectedCleaner !== "all" && activeCleanerRow ? [activeCleanerRow] : rows,
    [rows, selectedCleaner, activeCleanerRow]
  );

  const kpiOnTime = useMemo(() => {
    const scored = kpiRows.filter(r => r.on_time_rate != null);
    if (!scored.length) return null;
    return scored.reduce((s, r) => s + (r.on_time_rate ?? 0), 0) / scored.length;
  }, [kpiRows]);

  const kpiCleanliness = useMemo(() => {
    const scored = kpiRows.filter(r => r.cleanliness_score != null);
    if (!scored.length) return null;
    return scored.reduce((s, r) => s + (r.cleanliness_score ?? 0), 0) / scored.length;
  }, [kpiRows]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  const lastSyncedStr = meta?.lastSynced
    ? new Date(meta.lastSynced).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  // ─── Nav ──────────────────────────────────────────────────────────────────

  const nav = (
    <nav style={{
      background: "#0f172a", borderBottom: "1px solid #1e293b",
      padding: "0 24px", display: "flex", alignItems: "center", gap: 0, height: 52,
    }}>
      {/* Brand */}
      <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 16, marginRight: 28, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
        <span style={{ color: "#ffffff" }}>Vistas</span> Ops
      </span>

      {/* Divider */}
      <span style={{ width: 1, height: 20, background: "#1e293b", marginRight: 20, flexShrink: 0 }} />

      {/* Market dropdown */}
      <NavSelect
        value={market}
        onChange={v => { setMarket(v); setSelectedCleaner("all"); }}
        options={MARKET_OPTIONS}
      />

      {/* Divider */}
      <span style={{ width: 1, height: 20, background: "#1e293b", margin: "0 20px", flexShrink: 0 }} />

      {/* Cleaner dropdown */}
      <NavSelect
        value={selectedCleaner}
        onChange={v => setSelectedCleaner(v)}
        options={cleanerOptions}
      />

      <div style={{ flex: 1 }} />

      {/* Range + refresh */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {RANGES.map(r => (
          <button key={r.days} onClick={() => setRangeDays(r.days)} style={{
            padding: "4px 12px", border: "1px solid",
            borderColor: rangeDays === r.days ? "#ffffff" : "#334155",
            background: rangeDays === r.days ? "#ffffff" : "transparent",
            color: rangeDays === r.days ? "#0f172a" : "#64748b",
            borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}>
            {r.label}
          </button>
        ))}
        <button onClick={load} title="Refresh" style={{
          padding: "4px 10px", border: "1px solid #334155", borderRadius: 6,
          background: "transparent", color: "#64748b", fontSize: 13, cursor: "pointer", marginLeft: 4,
        }}>
          ↻
        </button>
      </div>
    </nav>
  );

  // ─── KPI cards ────────────────────────────────────────────────────────────

  const kpiCards = !loading && kpiRows.length > 0 && (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
      {[
        {
          label: selectedCleaner !== "all" ? "Cleans" : "Cleaners",
          value: selectedCleaner !== "all"
            ? (activeCleanerRow?.total_cleans ?? 0)
            : kpiRows.length,
          render: (v: number) => v.toLocaleString(),
        },
        {
          label: "Total Cleans",
          value: kpiRows.reduce((s, r) => s + r.total_cleans, 0),
          render: (v: number) => v.toLocaleString(),
          hidden: selectedCleaner !== "all",
        },
        {
          label: "Avg On-time",
          value: kpiOnTime,
          render: (v: number | null) => pct(v),
          highlight: rateColor(kpiOnTime),
        },
        {
          label: "Avg Cleanliness",
          value: kpiCleanliness,
          render: (v: number | null) => v == null ? "—" : v.toFixed(2),
          highlight: scoreColor(kpiCleanliness),
        },
        {
          label: "Reviews",
          value: kpiRows.reduce((s, r) => s + r.review_count, 0),
          render: (v: number) => v.toLocaleString(),
        },
        {
          label: "Properties",
          value: kpiRows.reduce((s, r) => s + r.property_count, 0),
          render: (v: number) => v.toLocaleString(),
        },
        ...(selectedCleaner !== "all" && activeCleanerRow ? [
          {
            label: "Median Time",
            value: activeCleanerRow.median_time,
            render: (v: number | null) => fmtTime(v),
          },
          {
            label: "Overdue",
            value: activeCleanerRow.tasks_overdue,
            render: (v: number) => v > 0 ? String(v) : "None",
            highlight: activeCleanerRow.tasks_overdue > 0 ? "#dc2626" : undefined,
          },
        ] : []),
      ]
        .filter(c => !c.hidden)
        .map(({ label, value, render, highlight }) => (
          <div key={label} style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
              {label}
            </div>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <div style={{ fontSize: 22, fontWeight: 700, color: highlight || "#0f172a", lineHeight: 1 }}>
              {(render as (v: typeof value) => string)(value)}
            </div>
          </div>
        ))}
    </div>
  );

  // ─── Summary table ────────────────────────────────────────────────────────

  function Th({ k, label, right = true }: { k: SortKey; label: string; right?: boolean }) {
    const active = sortKey === k;
    return (
      <th onClick={() => handleSort(k)} style={{
        padding: "10px 14px", textAlign: right ? "right" : "left",
        fontSize: 10, fontWeight: 600,
        color: active ? "#ffffff" : "#64748b",
        letterSpacing: "0.06em", textTransform: "uppercase",
        cursor: "pointer", whiteSpace: "nowrap", userSelect: "none",
        background: "transparent",
      }}>
        {label}{active ? (sortAsc ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  const summaryTable = (
    <div style={{ background: "#ffffff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
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
              <Th k="refund_count" label="Refunds" />
              <Th k="property_count" label="Props" />
              <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => (
              <tr
                key={row.vendor_name}
                onClick={() => setSelectedCleaner(row.vendor_name)}
                style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                <td style={{ padding: "12px 14px" }}>
                  <div style={{ fontWeight: 600, color: "#0f172a" }}>{row.vendor_name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                    {row.property_count} {row.property_count === 1 ? "property" : "properties"}
                  </div>
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: "#374151", fontVariantNumeric: "tabular-nums" }}>
                  {row.total_cleans}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: rateColor(row.on_time_rate), fontWeight: row.on_time_rate != null ? 600 : 400 }}>
                  {pct(row.on_time_rate)}
                  <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 11, marginLeft: 4 }}>
                    {row.on_time}/{row.decided}
                  </span>
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: scoreColor(row.cleanliness_score), fontWeight: row.cleanliness_score != null ? 600 : 400 }}>
                  {fmtScore(row.cleanliness_score)}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: "#6b7280" }}>{row.review_count || "—"}</td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: "#6b7280" }}>{fmtTime(row.median_time)}</td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: row.tasks_overdue > 0 ? "#dc2626" : "#6b7280", fontWeight: row.tasks_overdue > 0 ? 600 : 400 }}>
                  {row.tasks_overdue || "—"}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: row.refund_count > 0 ? "#dc2626" : "#6b7280", fontWeight: row.refund_count > 0 ? 600 : 400 }}>
                  {row.refund_count || "—"}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: "#6b7280" }}>{row.property_count}</td>
                <td style={{ padding: "12px 14px", textAlign: "center" }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: rateColor(row.on_time_rate),
                    display: "inline-block",
                  }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ─── Cleaner drill-down ───────────────────────────────────────────────────

  const drillDown = activeCleanerRow && (() => {
    const c = activeCleanerRow;
    const tasks = (c.enriched_tasks || [])
      .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));

    return (
      <div style={{ background: "#ffffff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>
            {c.vendor_name} — Task Detail
          </span>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            {tasks.length} cleans · {meta?.fromDate} → {meta?.toDate}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#0f172a" }}>
                {[
                  "Sched Date", "Property", "Status", "Finished (CST)",
                  "On Time?", "Deadline", "Duration", "Cleanliness", "Review",
                ].map(h => (
                  <th key={h} style={{
                    padding: "9px 12px", textAlign: "left", fontSize: 10,
                    fontWeight: 600, color: "#64748b", letterSpacing: "0.06em",
                    textTransform: "uppercase", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.map((t, i) => {
                const finishedStr = t.finished_cst
                  ? `${fmtDate(t.finished_cst.dateStr)} ${t.finished_cst.hour}:${String(t.finished_cst.minute).padStart(2, "0")}`
                  : null;

                const statusColor = !t.decided ? "#94a3b8" : t.is_finished ? "#16a34a" : "#dc2626";
                const statusLabel = !t.decided ? "Scheduled" : t.is_finished ? "Done" : "Overdue";

                const deadlineStyle: React.CSSProperties = t.deadline_type === "same-day"
                  ? { color: "#d97706", fontWeight: 500 }
                  : t.deadline_type === "next-ci"
                    ? { color: "#3b82f6", fontWeight: 500 }
                    : { color: "#94a3b8" };

                const deadlineLabel = t.deadline
                  ? (t.deadline_type === "same-day" ? `4PM ${fmtDate(t.deadline)}` : `4PM ${fmtDate(t.deadline)}`)
                  : "—";

                const reviewText = (t.review as { review_text?: string } | null)?.review_text || null;

                return (
                  <tr
                    key={t.task_id || i}
                    style={{ borderBottom: "1px solid #f8fafc" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                  >
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "#374151", fontWeight: 500 }}>
                      {fmtDate(t.scheduled_date)}
                    </td>
                    <td style={{ padding: "9px 12px", color: "#374151", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span title={t.property_name || undefined}>{t.property_name || "—"}</span>
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: statusColor, fontWeight: 500 }}>
                      {statusLabel}
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "#6b7280" }}>
                      {finishedStr || "—"}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "center" }}>
                      {!t.decided
                        ? <span style={{ color: "#94a3b8" }}>—</span>
                        : t.on_time
                          ? <span style={{ color: "#16a34a", fontWeight: 700, fontSize: 14 }}>✓</span>
                          : <span style={{ color: "#dc2626", fontWeight: 700, fontSize: 14 }}>✗</span>
                      }
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", ...deadlineStyle }}>
                      {deadlineLabel}
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "#6b7280" }}>
                      {fmtTime(parseTimeStr(t.total_time))}
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: scoreColor(t.review?.cleanliness ?? null), fontWeight: t.review?.cleanliness != null ? 600 : 400 }}>
                      {t.review?.cleanliness != null ? t.review.cleanliness.toFixed(1) : "—"}
                    </td>
                    <td style={{ padding: "9px 12px", color: "#6b7280", maxWidth: 260 }}>
                      {reviewText
                        ? <span title={reviewText} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reviewText}</span>
                        : "—"
                      }
                    </td>
                  </tr>
                );
              })}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: "32px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                    No tasks found for this cleaner in the selected range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  })();

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {nav}

      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "20px 24px" }}>

        {/* KPI cards */}
        {kpiCards}

        {/* Meta info bar */}
        {meta && !loading && (
          <div style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 12, color: "#94a3b8", flexWrap: "wrap", alignItems: "center" }}>
            <span>{meta.fromDate} → {meta.toDate}</span>
            <span>·</span>
            <span>{meta.taskCount.toLocaleString()} tasks</span>
            <span>·</span>
            <span>{meta.reviewCount} reviews</span>
            {lastSyncedStr && <><span>·</span><span>Last synced {lastSyncedStr}</span></>}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ marginBottom: 16, padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#dc2626", fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0", color: "#94a3b8", fontSize: 14 }}>
            Loading…
          </div>
        )}

        {/* Empty */}
        {!loading && rows.length === 0 && !error && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 8 }}>
            <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>No cleaner data for this range.</p>
            <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>Run the breezeway-tasks cron to populate data.</p>
          </div>
        )}

        {/* Summary table */}
        {!loading && rows.length > 0 && (
          <>
            {summaryTable}
            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
              Click any row to view that cleaner's individual tasks below.
            </p>
          </>
        )}

        {/* Drill-down (shown below table when a cleaner is selected) */}
        {!loading && drillDown && (
          <div style={{ marginTop: 20 }}>
            {drillDown}
          </div>
        )}
      </div>
    </div>
  );
}
