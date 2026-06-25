"use client";

import { useEffect, useState, useCallback } from "react";

const MARKETS = [
  { key: "all", label: "All Markets" },
  { key: "branson", label: "Branson / Ozarks" },
  { key: "deep_creek", label: "Deep Creek" },
  { key: "poconos", label: "Poconos" },
];

const RANGES = [
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
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
};

type Meta = {
  fromDate: string;
  toDate: string;
  lastSynced: string | null;
  taskCount: number;
  reviewCount: number;
  markets: string[];
};

type SortKey = keyof Row;

export default function Dashboard() {
  const [market, setMarket] = useState("all");
  const [rangeDays, setRangeDays] = useState(90);
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("on_time_rate");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

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
    if (rate == null) return <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#6b7280", display: "inline-block" }} />;
    if (rate >= 0.9) return <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />;
    if (rate >= 0.75) return <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />;
    return <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />;
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
      <th
        onClick={() => handleSort(k)}
        style={{
          padding: "10px 14px",
          textAlign: right ? "right" : "left",
          fontSize: 11,
          fontWeight: 600,
          color: active ? "#ffffff" : "#94a3b8",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          cursor: "pointer",
          whiteSpace: "nowrap",
          userSelect: "none",
          background: "transparent",
        }}
      >
        {label}{active ? (sortAsc ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  const lastSyncedStr = meta?.lastSynced
    ? new Date(meta.lastSynced).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  // Summary KPIs
  const avgOnTime = rows.length > 0
    ? rows.filter(r => r.on_time_rate != null).reduce((s, r) => s + (r.on_time_rate ?? 0), 0) / rows.filter(r => r.on_time_rate != null).length
    : null;
  const avgScore = rows.length > 0
    ? rows.filter(r => r.cleanliness_score != null).reduce((s, r) => s + (r.cleanliness_score ?? 0), 0) / rows.filter(r => r.cleanliness_score != null).length
    : null;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Top nav */}
      <nav style={{ background: "#0f172a", borderBottom: "1px solid #1e293b", padding: "0 24px", display: "flex", alignItems: "center", gap: 0, height: 48 }}>
        <span style={{ color: "#94a3b8", fontWeight: 600, fontSize: 15, marginRight: 24, letterSpacing: "-0.01em" }}>
          <span style={{ color: "#ffffff" }}>Vistas</span> Ops
        </span>
        {MARKETS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMarket(m.key)}
            style={{
              padding: "0 16px",
              height: 48,
              border: "none",
              borderBottom: market === m.key ? "2px solid #ffffff" : "2px solid transparent",
              background: "transparent",
              color: market === m.key ? "#ffffff" : "#64748b",
              fontSize: 13,
              fontWeight: market === m.key ? 600 : 400,
              cursor: "pointer",
              letterSpacing: "0.01em",
              transition: "color 0.15s",
            }}
          >
            {m.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 4 }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setRangeDays(r.days)}
              style={{
                padding: "4px 12px",
                border: "1px solid",
                borderColor: rangeDays === r.days ? "#ffffff" : "#334155",
                borderRadius: 6,
                background: rangeDays === r.days ? "#ffffff" : "transparent",
                color: rangeDays === r.days ? "#0f172a" : "#64748b",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {r.label}
            </button>
          ))}
          <button
            onClick={load}
            style={{ padding: "4px 10px", border: "1px solid #334155", borderRadius: 6, background: "transparent", color: "#64748b", fontSize: 12, cursor: "pointer", marginLeft: 4 }}
          >
            ↻
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px" }}>
        {/* KPI row */}
        {!loading && rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Cleaners", value: rows.length, format: (v: number) => String(v) },
              { label: "Total Cleans", value: rows.reduce((s, r) => s + r.total_cleans, 0), format: (v: number) => v.toLocaleString() },
              { label: "Avg On-time", value: avgOnTime, format: (v: number | null) => pct(v) },
              { label: "Avg Cleanliness", value: avgScore, format: (v: number | null) => fmt(v) },
              { label: "Total Reviews", value: rows.reduce((s, r) => s + r.review_count, 0), format: (v: number) => String(v) },
              { label: "Properties", value: rows.reduce((s, r) => s + r.property_count, 0), format: (v: number) => String(v) },
            ].map(({ label, value, format }) => (
              <div key={label} style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 18px" }}>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 600, color: "#0f172a", lineHeight: 1 }}>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {(format as (v: any) => string)(value)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Meta bar */}
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0", color: "#94a3b8", fontSize: 14 }}>
            Loading…
          </div>
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
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                      Unit
                    </th>
                    <Th k="total_cleans" label="Cleans" />
                    <Th k="on_time_rate" label="On-time %" />
                    <Th k="cleanliness_score" label="Cleanliness" />
                    <Th k="review_count" label="Reviews" />
                    <Th k="median_time" label="Median time" />
                    <Th k="tasks_overdue" label="Overdue" />
                    <Th k="refund_count" label="Refunds" />
                    <Th k="property_count" label="Props" />
                    <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => {
                    const isExpanded = expandedRow === row.vendor_name;
                    return (
                      <>
                        <tr
                          key={row.vendor_name}
                          onClick={() => setExpandedRow(isExpanded ? null : row.vendor_name)}
                          style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: isExpanded ? "#f8fafc" : "#ffffff" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                          onMouseLeave={e => (e.currentTarget.style.background = isExpanded ? "#f8fafc" : "#ffffff")}
                        >
                          <td style={{ padding: "12px 14px" }}>
                            <div style={{ fontWeight: 600, color: "#0f172a", fontSize: 13 }}>{row.vendor_name}</div>
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: "#374151", fontVariantNumeric: "tabular-nums" }}>
                            {row.total_cleans}
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", ...rateStyle(row.on_time_rate) }}>
                            {pct(row.on_time_rate)}
                            <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 11, marginLeft: 4 }}>
                              {row.on_time}/{row.decided}
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", ...scoreStyle(row.cleanliness_score) }}>
                            {fmt(row.cleanliness_score)}
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>
                            {row.review_count || "—"}
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: "#6b7280" }}>
                            {fmtTime(row.median_time)}
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: row.tasks_overdue > 0 ? "#dc2626" : "#6b7280", fontWeight: row.tasks_overdue > 0 ? 600 : 400 }}>
                            {row.tasks_overdue || "—"}
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: row.refund_count > 0 ? "#dc2626" : "#6b7280", fontWeight: row.refund_count > 0 ? 600 : 400 }}>
                            {row.refund_count || "—"}
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", color: "#6b7280" }}>
                            {row.property_count}
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "center" }}>
                            {statusDot(row.on_time_rate)}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${row.vendor_name}-detail`} style={{ background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                            <td colSpan={10} style={{ padding: "10px 14px 14px 14px" }}>
                              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Properties</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {(row.properties || []).map((p: string) => (
                                  <span key={p} style={{ padding: "3px 10px", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12, color: "#374151" }}>
                                    {p}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
