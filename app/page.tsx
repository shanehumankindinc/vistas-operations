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

function fmt(n: number | null, decimals = 1) {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

function pct(n: number | null) {
  if (n == null) return "—";
  return (n * 100).toFixed(0) + "%";
}

function rateColor(rate: number | null) {
  if (rate == null) return "text-zinc-400";
  if (rate >= 0.9) return "text-emerald-600 font-semibold";
  if (rate >= 0.75) return "text-yellow-600 font-semibold";
  return "text-red-600 font-semibold";
}

function scoreColor(score: number | null) {
  if (score == null) return "text-zinc-400";
  if (score >= 4.7) return "text-emerald-600 font-semibold";
  if (score >= 4.3) return "text-yellow-600 font-semibold";
  return "text-red-600 font-semibold";
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
};

type Meta = {
  fromDate: string;
  toDate: string;
  lastSynced: string | null;
  taskCount: number;
  reviewCount: number;
  markets: string[];
};

export default function Dashboard() {
  const [market, setMarket] = useState("all");
  const [rangeDays, setRangeDays] = useState(90);
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<keyof Row>("on_time_rate");
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

  function handleSort(key: keyof Row) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity;
    const bv = b[sortKey] ?? -Infinity;
    if (typeof av === "string" && typeof bv === "string") {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  function Th({ k, label }: { k: keyof Row; label: string }) {
    const active = sortKey === k;
    return (
      <th
        onClick={() => handleSort(k)}
        className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wide cursor-pointer select-none hover:text-zinc-900 whitespace-nowrap"
      >
        {label} {active ? (sortAsc ? "↑" : "↓") : ""}
      </th>
    );
  }

  const lastSyncedStr = meta?.lastSynced
    ? new Date(meta.lastSynced).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Vistas Operations</h1>
            <p className="text-sm text-zinc-500 mt-0.5">Cleaner scorecard — all markets</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {/* Market tabs */}
            <div className="flex rounded-lg border border-zinc-200 overflow-hidden text-sm">
              {MARKETS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMarket(m.key)}
                  className={`px-3 py-1.5 font-medium transition-colors ${
                    market === m.key
                      ? "bg-zinc-900 text-white"
                      : "bg-white text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {/* Range tabs */}
            <div className="flex rounded-lg border border-zinc-200 overflow-hidden text-sm">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setRangeDays(r.days)}
                  className={`px-3 py-1.5 font-medium transition-colors ${
                    rangeDays === r.days
                      ? "bg-zinc-900 text-white"
                      : "bg-white text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={load}
              className="px-3 py-1.5 rounded-lg border border-zinc-200 text-sm font-medium hover:bg-zinc-100 transition-colors"
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Meta bar */}
        {meta && !loading && (
          <div className="flex flex-wrap gap-4 mb-4 text-sm text-zinc-500">
            <span>{meta.fromDate} → {meta.toDate}</span>
            <span>·</span>
            <span>{meta.taskCount.toLocaleString()} tasks</span>
            <span>·</span>
            <span>{meta.reviewCount} reviews</span>
            {lastSyncedStr && (
              <>
                <span>·</span>
                <span>Last synced {lastSyncedStr}</span>
              </>
            )}
            {rows.length > 0 && (
              <>
                <span>·</span>
                <span>{rows.length} cleaners</span>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24 text-zinc-400 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-2">
            <p className="text-zinc-500 text-sm">No cleaner data for this range.</p>
            <p className="text-zinc-400 text-xs">Run the breezeway-tasks cron to populate data.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-100 bg-zinc-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                      Cleaner
                    </th>
                    <Th k="total_cleans" label="Cleans" />
                    <Th k="on_time_rate" label="On-time" />
                    <Th k="tasks_overdue" label="Overdue" />
                    <Th k="cleanliness_score" label="Cleanliness" />
                    <Th k="review_count" label="Reviews" />
                    <Th k="median_time" label="Median time" />
                    <Th k="refund_count" label="Refunds" />
                    <Th k="property_count" label="Props" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {sorted.map((row) => {
                    const isExpanded = expandedRow === row.vendor_name;
                    return (
                      <>
                        <tr
                          key={row.vendor_name}
                          onClick={() => setExpandedRow(isExpanded ? null : row.vendor_name)}
                          className="hover:bg-zinc-50 cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3 font-medium text-zinc-900">{row.vendor_name}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-zinc-700">{row.total_cleans}</td>
                          <td className={`px-3 py-3 text-right tabular-nums ${rateColor(row.on_time_rate)}`}>
                            {pct(row.on_time_rate)}
                            <span className="text-zinc-400 font-normal text-xs ml-1">
                              ({row.on_time}/{row.decided})
                            </span>
                          </td>
                          <td className={`px-3 py-3 text-right tabular-nums ${row.tasks_overdue > 0 ? "text-red-600 font-semibold" : "text-zinc-400"}`}>
                            {row.tasks_overdue || "—"}
                          </td>
                          <td className={`px-3 py-3 text-right tabular-nums ${scoreColor(row.cleanliness_score)}`}>
                            {fmt(row.cleanliness_score)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-zinc-500">{row.review_count || "—"}</td>
                          <td className="px-3 py-3 text-right text-zinc-500">{fmtTime(row.median_time)}</td>
                          <td className={`px-3 py-3 text-right tabular-nums ${row.refund_count > 0 ? "text-red-600 font-semibold" : "text-zinc-400"}`}>
                            {row.refund_count || "—"}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-zinc-500">{row.property_count}</td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${row.vendor_name}-detail`} className="bg-zinc-50">
                            <td colSpan={9} className="px-4 py-3">
                              <div className="text-xs text-zinc-500 font-medium mb-1">Properties</div>
                              <div className="flex flex-wrap gap-1">
                                {((row as unknown as { properties: string[] }).properties || []).map((p: string) => (
                                  <span key={p} className="px-2 py-0.5 bg-white border border-zinc-200 rounded text-xs text-zinc-700">
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
