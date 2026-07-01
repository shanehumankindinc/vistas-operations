"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";

const MARKET_OPTIONS = [
  { key: "all", label: "All Markets" },
  { key: "branson", label: "Branson" },
  { key: "deep_creek", label: "Deep Creek" },
  { key: "poconos", label: "Poconos" },
];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type ReportRow = {
  id: string;
  market: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  report_type: string;
  cleaner_company: string | null;
  created_by: string | null;
};

function formatPeriod(start: string, end: string) {
  const fmt = (d: string) =>
    new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatMarket(m: string) {
  return { branson: "Branson", deep_creek: "Deep Creek", poconos: "Poconos" }[m] || m;
}

const GROUPS_PER_PAGE = 4; // number of period-groups shown per page

export default function ReportsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Filters
  const [market, setMarket] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [cleanerFilter, setCleanerFilter] = useState("all");

  // Pagination
  const [page, setPage] = useState(1);

  // Generate modal
  const [showGenModal, setShowGenModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genMarket, setGenMarket] = useState("branson");
  const [genStart, setGenStart] = useState("");
  const [genEnd, setGenEnd] = useState("");
  const [genResult, setGenResult] = useState<string | null>(null);

  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)ops_ui=([^;]+)/);
    if (match) {
      try {
        const u = JSON.parse(decodeURIComponent(match[1]));
        setUserRole(u.role || null);
      } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastOfLastMonth = new Date(firstOfMonth.getTime() - 1);
    const firstOfLastMonth = new Date(lastOfLastMonth.getFullYear(), lastOfLastMonth.getMonth(), 1);
    setGenStart(firstOfLastMonth.toISOString().slice(0, 10));
    setGenEnd(lastOfLastMonth.toISOString().slice(0, 10));
  }, []);

  const load = async () => {
    setLoading(true);
    // Fetch all rows for the selected market; client-side handles year/month/cleaner filters.
    const params = new URLSearchParams();
    if (market !== "all") params.set("market", market);
    const res = await fetch(`/api/reports?${params}`);
    if (res.status === 401) { router.push("/login"); return; }
    const json = await res.json();
    setRows(json.rows || []);
    setPage(1); // reset pagination on new fetch
    setLoading(false);
  };

  useEffect(() => { load(); }, [market]);

  // Reset to page 1 whenever a filter changes
  useEffect(() => { setPage(1); }, [yearFilter, monthFilter, cleanerFilter]);

  // Derived: available years, months, cleaners from the full row set
  const availableYears = useMemo(() => {
    const years = new Set(rows.map((r) => r.period_start.slice(0, 4)));
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [rows]);

  const availableMonths = useMemo(() => {
    const months = new Set(
      rows
        .filter((r) => yearFilter === "all" || r.period_start.startsWith(yearFilter))
        .map((r) => r.period_start.slice(5, 7))
    );
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [rows, yearFilter]);

  const availableCleaners = useMemo(() => {
    const cleaners = new Set(rows.map((r) => r.cleaner_company).filter(Boolean));
    return Array.from(cleaners).sort() as string[];
  }, [rows]);

  // Apply client-side filters
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (yearFilter !== "all" && !r.period_start.startsWith(yearFilter)) return false;
      if (monthFilter !== "all" && r.period_start.slice(5, 7) !== monthFilter) return false;
      if (cleanerFilter !== "all" && r.cleaner_company !== cleanerFilter) return false;
      return true;
    });
  }, [rows, yearFilter, monthFilter, cleanerFilter]);

  // Group by period_start
  const grouped = useMemo(() => {
    const map: Record<string, ReportRow[]> = {};
    for (const r of filtered) {
      if (!map[r.period_start]) map[r.period_start] = [];
      map[r.period_start].push(r);
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  // Paginate the groups
  const totalPages = Math.max(1, Math.ceil(grouped.length / GROUPS_PER_PAGE));
  const visibleGroups = grouped.slice((page - 1) * GROUPS_PER_PAGE, page * GROUPS_PER_PAGE);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenResult(null);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market: genMarket, period_start: genStart, period_end: genEnd }),
      });
      const json = await res.json();
      if (!res.ok) {
        setGenResult("Error: " + (json.error || "Unknown error"));
      } else if (json.generated === 0 && json.errors?.length > 0) {
        setGenResult("Error: " + json.errors[0].error);
      } else if (json.generated === 0 && json.message) {
        setGenResult("Error: " + json.message);
      } else {
        setGenResult(`Generated ${json.generated} report${json.generated !== 1 ? "s" : ""} for ${genMarket}.`);
        load();
      }
    } catch (e: any) {
      setGenResult("Error: " + e.message);
    } finally {
      setGenerating(false);
    }
  };

  const hasFilters = yearFilter !== "all" || monthFilter !== "all" || cleanerFilter !== "all" || market !== "all";
  const clearFilters = () => {
    setYearFilter("all");
    setMonthFilter("all");
    setCleanerFilter("all");
    setMarket("all");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      {/* Nav */}
      <div style={{ background: "#0f172a", padding: "0 24px", display: "flex", alignItems: "center", height: 52, gap: 20 }}>
        <a href="/" style={{ color: "#94a3b8", fontWeight: 700, fontSize: 16, textDecoration: "none" }}>
          <span style={{ color: "#ffffff" }}>Vistas</span> Ops
        </a>
        <span style={{ width: 1, height: 20, background: "#1e293b" }} />
        <span style={{ color: "#ffffff", fontSize: 13, fontWeight: 600 }}>Reports</span>
        <div style={{ flex: 1 }} />
        <a href="/" style={{ fontSize: 12, color: "#64748b", textDecoration: "none" }}>← Back to Scorecard</a>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 16px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>Cleaner Performance Reports</h1>
          <div style={{ flex: 1 }} />
          {userRole === "admin" && (
            <button
              onClick={() => { setShowGenModal(true); setGenResult(null); }}
              style={{ padding: "7px 16px", background: "#1a7a3c", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              + Generate Report
            </button>
          )}
        </div>

        {/* Filter bar */}
        {!loading && rows.length > 0 && (
          <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
            {/* Market — admin/employee only */}
            {userRole !== "vendor" && (
              <select value={market} onChange={(e) => setMarket(e.target.value)} style={selectStyle}>
                {MARKET_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            )}
            {/* Year */}
            <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} style={selectStyle}>
              <option value="all">All Years</option>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            {/* Month */}
            <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} style={selectStyle}>
              <option value="all">All Months</option>
              {availableMonths.map((m) => <option key={m} value={m}>{MONTH_NAMES[parseInt(m, 10) - 1]}</option>)}
            </select>
            {/* Cleaner — admin/employee only */}
            {userRole !== "vendor" && availableCleaners.length > 1 && (
              <select value={cleanerFilter} onChange={(e) => setCleanerFilter(e.target.value)} style={{ ...selectStyle, maxWidth: 200 }}>
                <option value="all">All Cleaners</option>
                {availableCleaners.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {/* Result count + clear */}
            <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 4 }}>
              {filtered.length} report{filtered.length !== 1 ? "s" : ""}
            </span>
            {hasFilters && (
              <button onClick={clearFilters} style={{ fontSize: 12, color: "#6b7280", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Generate modal */}
        {showGenModal && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "#fff", borderRadius: 10, padding: 28, width: 380, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
              <h2 style={{ margin: "0 0 20px", fontSize: 17, fontWeight: 700, color: "#111827" }}>Generate Reports</h2>
              <label style={labelStyle}>Market</label>
              <select value={genMarket} onChange={(e) => setGenMarket(e.target.value)} style={inputStyle}>
                {MARKET_OPTIONS.filter((o) => o.key !== "all").map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
              <label style={labelStyle}>Period Start</label>
              <input type="date" value={genStart} onChange={(e) => setGenStart(e.target.value)} style={inputStyle} />
              <label style={labelStyle}>Period End</label>
              <input type="date" value={genEnd} onChange={(e) => setGenEnd(e.target.value)} style={inputStyle} />
              {genResult && (
                <div style={{ marginTop: 12, padding: "10px 12px", background: genResult.startsWith("Error") ? "#fef2f2" : "#f0fdf4", borderRadius: 6, fontSize: 13, color: genResult.startsWith("Error") ? "#b91c1c" : "#065f46" }}>
                  {genResult}
                </div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button
                  onClick={handleGenerate}
                  disabled={generating || !genStart || !genEnd}
                  style={{ flex: 1, padding: "9px 0", background: generating ? "#9ca3af" : "#1a7a3c", color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 14, cursor: generating ? "default" : "pointer" }}
                >
                  {generating ? "Generating…" : "Generate"}
                </button>
                <button
                  onClick={() => setShowGenModal(false)}
                  style={{ padding: "9px 18px", background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, cursor: "pointer" }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Report list */}
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>Loading…</div>
        ) : grouped.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "#9ca3af", fontSize: 14, background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb" }}>
            {rows.length === 0
              ? (userRole === "admin" ? `No reports yet. Click "Generate Report" to create your first one.` : "No reports yet. Check back after reports are published.")
              : "No reports match the selected filters."}
          </div>
        ) : (
          <>
            {visibleGroups.map(([periodStart, periodRows]) => (
              <div key={periodStart} style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", letterSpacing: "0.06em", marginBottom: 10, textTransform: "uppercase" }}>
                  {formatPeriod(periodStart, periodRows[0].period_end)}
                  <span style={{ fontWeight: 400, marginLeft: 8 }}>({periodRows.length} report{periodRows.length !== 1 ? "s" : ""})</span>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                  {periodRows.map((row, i) => (
                    <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 18px", borderTop: i > 0 ? "1px solid #f3f4f6" : "none" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", marginBottom: 2 }}>
                          {row.cleaner_company || "Portfolio"}
                        </div>
                        <div style={{ fontSize: 11, color: "#9ca3af" }}>
                          {formatMarket(row.market)}
                          {" · "}Generated {new Date(row.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </div>
                      </div>
                      {row.id ? (
                        <a
                          href={`/api/reports/${row.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ padding: "6px 14px", background: "#f0fdf4", color: "#1a7a3c", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
                        >
                          View ↗
                        </a>
                      ) : (
                        <span style={{ fontSize: 12, color: "#9ca3af" }}>Unavailable</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 8, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{ padding: "6px 14px", background: page === 1 ? "#f3f4f6" : "#fff", color: page === 1 ? "#9ca3af" : "#374151", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, cursor: page === 1 ? "default" : "pointer" }}
                >
                  ← Prev
                </button>
                <span style={{ fontSize: 13, color: "#6b7280" }}>
                  Page {page} of {totalPages} &nbsp;·&nbsp; {grouped.length} period{grouped.length !== 1 ? "s" : ""} total
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  style={{ padding: "6px 14px", background: page === totalPages ? "#f3f4f6" : "#fff", color: page === totalPages ? "#9ca3af" : "#374151", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, cursor: page === totalPages ? "default" : "pointer" }}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = { padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, background: "#fff", color: "#374151" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4, marginTop: 14 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, color: "#111827", background: "#fff" };
