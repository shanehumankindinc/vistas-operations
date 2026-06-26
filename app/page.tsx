"use client";

import { useEffect, useState, useCallback, useMemo } from "react";

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
};

type Meta = {
  fromDate: string;
  toDate: string;
  lastSynced: string | null;
  taskCount: number;
  reviewCount: number;
};

type SortKey = keyof Omit<Row, never>;

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

function fmtMoney(n: number) {
  if (!n) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

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

function NavSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { key: string; label: string }[];
}) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        background: "transparent", border: "none", color: "#ffffff", fontSize: 14,
        fontWeight: 500, cursor: "pointer", paddingRight: 20,
        appearance: "none", WebkitAppearance: "none", outline: "none", maxWidth: 200,
      }}>
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

  const kpiOnTime = useMemo(() => {
    const s = kpiRows.filter(r => r.on_time_rate != null);
    return s.length ? s.reduce((a, r) => a + (r.on_time_rate ?? 0), 0) / s.length : null;
  }, [kpiRows]);

  const kpiCleanliness = useMemo(() => {
    const s = kpiRows.filter(r => r.cleanliness_score != null);
    return s.length ? s.reduce((a, r) => a + (r.cleanliness_score ?? 0), 0) / s.length : null;
  }, [kpiRows]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  const lastSyncedStr = meta?.lastSynced
    ? new Date(meta.lastSynced).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  function Th({ k, label, right = true }: { k: SortKey; label: string; right?: boolean }) {
    const active = sortKey === k;
    return (
      <th onClick={() => handleSort(k)} style={{
        padding: "10px 14px", textAlign: right ? "right" : "left", fontSize: 10,
        fontWeight: 600, color: active ? "#ffffff" : "#64748b",
        letterSpacing: "0.06em", textTransform: "uppercase",
        cursor: "pointer", whiteSpace: "nowrap", userSelect: "none",
      }}>
        {label}{active ? (sortAsc ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* Nav */}
      <nav style={{ background: "#0f172a", borderBottom: "1px solid #1e293b", padding: "0 24px", display: "flex", alignItems: "center", height: 52, gap: 0 }}>
        <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 16, marginRight: 28, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
          <span style={{ color: "#ffffff" }}>Vistas</span> Ops
        </span>
        <span style={{ width: 1, height: 20, background: "#1e293b", marginRight: 20, flexShrink: 0 }} />
        <NavSelect value={market} onChange={v => { setMarket(v); setFilterCleaner("all"); }} options={MARKET_OPTIONS} />
        <span style={{ width: 1, height: 20, background: "#1e293b", margin: "0 20px", flexShrink: 0 }} />
        <NavSelect value={filterCleaner} onChange={setFilterCleaner} options={cleanerOptions} />
        <div style={{ flex: 1 }} />
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

      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "20px 24px" }}>

        {/* KPI cards */}
        {!loading && kpiRows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 16 }}>
            {[
              { label: filterCleaner !== "all" ? "Cleans" : "Cleaners", value: filterCleaner !== "all" ? kpiRows[0]?.total_cleans : kpiRows.length, render: (v: number) => v.toLocaleString() },
              { label: "Total Cleans", value: kpiRows.reduce((s, r) => s + r.total_cleans, 0), render: (v: number) => v.toLocaleString(), hide: filterCleaner !== "all" },
              { label: "Avg On-time", value: kpiOnTime, render: (v: number | null) => pct(v), color: rateColor(kpiOnTime) },
              { label: "Avg Cleanliness", value: kpiCleanliness, render: (v: number | null) => v == null ? "—" : v.toFixed(2), color: scoreColor(kpiCleanliness) },
              { label: "Reviews", value: kpiRows.reduce((s, r) => s + r.review_count, 0), render: (v: number) => v.toLocaleString() },
              { label: "Properties", value: kpiRows.reduce((s, r) => s + r.property_count, 0), render: (v: number) => v.toLocaleString() },
            ].filter(c => !c.hide).map(({ label, value, render, color }) => (
              <div key={label} style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 18px" }}>
                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <div style={{ fontSize: 22, fontWeight: 700, color: color || "#0f172a", lineHeight: 1 }}>{(render as (v: any) => string)(value)}</div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div style={{ marginBottom: 16, padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#dc2626", fontSize: 13 }}>{error}</div>
        )}

        {/* Main card */}
        <div style={{ background: "#ffffff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>

          {/* Meta strip */}
          {meta && !loading && (
            <div style={{ padding: "8px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 12, fontSize: 11, color: "#94a3b8", flexWrap: "wrap", alignItems: "center" }}>
              <span>{meta.fromDate} → {meta.toDate}</span>
              <span>·</span>
              <span>{meta.taskCount.toLocaleString()} tasks</span>
              <span>·</span>
              <span>{meta.reviewCount} reviews</span>
              {lastSyncedStr && <><span>·</span><span>Last synced {lastSyncedStr}</span></>}
            </div>
          )}

          {loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0", color: "#94a3b8", fontSize: 14 }}>Loading…</div>
          )}

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
                    <tr key={row.vendor_name} style={{ borderBottom: "1px solid #f1f5f9" }}
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
                      <td style={{ padding: "12px 14px", textAlign: "right", color: row.refund_amount > 0 ? "#dc2626" : "#6b7280", fontWeight: row.refund_amount > 0 ? 600 : 400 }}>
                        {fmtMoney(row.refund_amount)}
                      </td>
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
