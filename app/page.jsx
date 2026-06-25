"use client";
import { useState, useEffect, useMemo } from "react";

const MARKETS = {
  all: "All Markets",
  branson: "Branson / Ozarks",
  deep_creek: "Deep Creek",
  poconos: "Poconos",
};

function pct(rate) {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}

function score(val) {
  if (val == null) return "—";
  return val.toFixed(2);
}

function fmtMins(mins) {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function otrColor(rate) {
  if (rate == null) return "text-gray-400";
  if (rate >= 0.8) return "text-green-400";
  if (rate >= 0.6) return "text-yellow-400";
  return "text-red-400";
}

function scoreColor(val) {
  if (val == null) return "text-gray-400";
  if (val >= 4.5) return "text-green-400";
  if (val >= 4.0) return "text-yellow-400";
  return "text-red-400";
}

const SORT_COLS = ["vendor_name", "total_cleans", "on_time_rate", "cleanliness_score", "refund_amount", "median_time", "property_count"];

export default function Home() {
  const [market, setMarket] = useState("all");
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortCol, setSortCol] = useState("on_time_rate");
  const [sortDir, setSortDir] = useState("desc");
  const [expanded, setExpanded] = useState(null);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ market, from: fromDate, to: toDate });
      const res = await fetch(`/api/data?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchData(); }, [market, fromDate, toDate]);

  const sorted = useMemo(() => {
    if (!data?.scorecard) return [];
    return [...data.scorecard].sort((a, b) => {
      const av = a[sortCol] ?? (sortDir === "asc" ? Infinity : -Infinity);
      const bv = b[sortCol] ?? (sortDir === "asc" ? Infinity : -Infinity);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [data, sortCol, sortDir]);

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  }

  const portfolioOTR = useMemo(() => {
    if (!data?.scorecard?.length) return null;
    const totalOn = data.scorecard.reduce((s, c) => s + (c.on_time || 0), 0);
    const totalDecided = data.scorecard.reduce((s, c) => s + (c.decided || 0), 0);
    return totalDecided > 0 ? totalOn / totalDecided : null;
  }, [data]);

  const portfolioScore = useMemo(() => {
    if (!data?.scorecard?.length) return null;
    const withScores = data.scorecard.filter(c => c.cleanliness_score != null && c.review_count > 0);
    if (!withScores.length) return null;
    const total = withScores.reduce((s, c) => s + c.cleanliness_score * c.review_count, 0);
    const count = withScores.reduce((s, c) => s + c.review_count, 0);
    return count > 0 ? total / count : null;
  }, [data]);

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <span className="ml-1 text-gray-600">↕</span>;
    return <span className="ml-1 text-blue-400">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  const thCls = "px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-white";
  const tdCls = "px-4 py-3 text-sm";

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Vistas Operations</h1>
          <p className="text-xs text-gray-500 mt-0.5">Cleaner Scorecard — Multi-Market</p>
        </div>
        {data?.meta?.lastSynced && (
          <span className="text-xs text-gray-500">
            Last sync: {new Date(data.meta.lastSynced).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="px-6 py-4 flex flex-wrap gap-3 items-center border-b border-gray-800">
        <select
          value={market}
          onChange={e => setMarket(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          {Object.entries(MARKETS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        />
        <span className="text-gray-500 text-sm">to</span>
        <input
          type="date"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* KPI Summary */}
      {data && (
        <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-gray-800">
          <KPI label="Cleaners" value={data.scorecard?.filter(c => c.vendor_name !== "Unassigned").length ?? "—"} />
          <KPI label="Portfolio On-Time" value={pct(portfolioOTR)} color={otrColor(portfolioOTR)} />
          <KPI label="Avg Cleanliness" value={score(portfolioScore)} color={scoreColor(portfolioScore)} />
          <KPI label="Total Cleans" value={data.scorecard?.reduce((s, c) => s + c.total_cleans, 0) ?? "—"} />
        </div>
      )}

      {/* Table */}
      <div className="px-6 py-4">
        {loading && <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>}
        {error && <p className="text-red-400 text-sm py-8 text-center">Error: {error}</p>}
        {!loading && !error && data && (
          <div className="rounded-lg border border-gray-800 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-900">
                <tr>
                  <th className={thCls} onClick={() => toggleSort("vendor_name")}>Cleaner<SortIcon col="vendor_name" /></th>
                  <th className={thCls} onClick={() => toggleSort("total_cleans")}>Cleans<SortIcon col="total_cleans" /></th>
                  <th className={thCls} onClick={() => toggleSort("on_time_rate")}>On-Time<SortIcon col="on_time_rate" /></th>
                  <th className={thCls} onClick={() => toggleSort("cleanliness_score")}>Review Score<SortIcon col="cleanliness_score" /></th>
                  <th className={thCls} onClick={() => toggleSort("refund_amount")}>Refunds<SortIcon col="refund_amount" /></th>
                  <th className={thCls} onClick={() => toggleSort("median_time")}>Median Time<SortIcon col="median_time" /></th>
                  <th className={thCls} onClick={() => toggleSort("property_count")}>Properties<SortIcon col="property_count" /></th>
                  <th className={`${thCls} cursor-default`}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {sorted.map((c) => (
                  <>
                    <tr
                      key={c.vendor_name}
                      className="hover:bg-gray-900 cursor-pointer transition-colors"
                      onClick={() => setExpanded(expanded === c.vendor_name ? null : c.vendor_name)}
                    >
                      <td className={`${tdCls} font-medium`}>{c.vendor_name}</td>
                      <td className={tdCls}>{c.total_cleans}</td>
                      <td className={`${tdCls} font-semibold ${otrColor(c.on_time_rate)}`}>
                        {pct(c.on_time_rate)}
                        <span className="text-gray-500 font-normal text-xs ml-1">
                          ({c.on_time}/{c.decided})
                        </span>
                      </td>
                      <td className={`${tdCls} font-semibold ${scoreColor(c.cleanliness_score)}`}>
                        {score(c.cleanliness_score)}
                        <span className="text-gray-500 font-normal text-xs ml-1">
                          ({c.review_count} reviews)
                        </span>
                      </td>
                      <td className={`${tdCls} ${c.refund_count > 0 ? "text-orange-400" : "text-gray-500"}`}>
                        {c.refund_count > 0 ? `${c.refund_count} · $${c.refund_amount.toFixed(0)}` : "—"}
                      </td>
                      <td className={tdCls}>{fmtMins(c.median_time)}</td>
                      <td className={tdCls}>{c.property_count}</td>
                      <td className={`${tdCls} text-gray-500 text-xs`}>
                        {expanded === c.vendor_name ? "▲" : "▼"}
                      </td>
                    </tr>
                    {expanded === c.vendor_name && (
                      <tr key={`${c.vendor_name}-detail`}>
                        <td colSpan={8} className="bg-gray-900 px-6 py-4">
                          <DetailPanel cleaner={c} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500 text-sm">
                      No data for this date range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function KPI({ label, value, color = "text-white" }) {
  return (
    <div className="bg-gray-900 rounded-lg px-4 py-3 border border-gray-800">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function DetailPanel({ cleaner }) {
  const tasks = (cleaner.tasks || [])
    .filter(t => (t.task_title || "").toLowerCase().includes("clean"))
    .sort((a, b) => b.scheduled_date?.localeCompare(a.scheduled_date));

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Recent Cleans — {cleaner.vendor_name}
      </p>
      {tasks.length === 0 ? (
        <p className="text-gray-500 text-sm">No completed cleans in this period.</p>
      ) : (
        <div className="rounded border border-gray-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800">
                <th className="px-3 py-2 text-left text-gray-400 font-medium">Date</th>
                <th className="px-3 py-2 text-left text-gray-400 font-medium">Property</th>
                <th className="px-3 py-2 text-left text-gray-400 font-medium">Status</th>
                <th className="px-3 py-2 text-left text-gray-400 font-medium">Finished</th>
                <th className="px-3 py-2 text-left text-gray-400 font-medium">On Time</th>
                <th className="px-3 py-2 text-left text-gray-400 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {tasks.slice(0, 20).map(t => (
                <tr key={t.task_id} className="hover:bg-gray-800">
                  <td className="px-3 py-2 text-gray-300">{t.scheduled_date}</td>
                  <td className="px-3 py-2 text-gray-300 max-w-[200px] truncate">{t.property_name}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                      t.clean_status === "Completed" ? "bg-green-900 text-green-300" :
                      t.clean_status === "Overdue" ? "bg-red-900 text-red-300" :
                      "bg-gray-700 text-gray-300"
                    }`}>{t.clean_status || "—"}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-400">
                    {t.finished_at ? new Date(t.finished_at).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {t.finished_at == null ? <span className="text-gray-500">Pending</span> :
                     t.is_on_time === true ? <span className="text-green-400">✓</span> :
                     t.is_on_time === false ? <span className="text-red-400">✗</span> :
                     <span className="text-gray-500">—</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-400">{t.total_time || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tasks.length > 20 && (
            <p className="text-center text-gray-500 text-xs py-2 bg-gray-800">
              Showing 20 of {tasks.length} cleans
            </p>
          )}
        </div>
      )}
    </div>
  );
}
