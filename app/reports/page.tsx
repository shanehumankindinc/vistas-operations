"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";

const MARKET_OPTIONS = [
  { key: "all", label: "All Markets" },
  { key: "branson", label: "Branson" },
  { key: "deep_creek", label: "Deep Creek" },
  { key: "poconos", label: "Poconos" },
];

type ReportRow = {
  id: string;
  market: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  report_type: string;
  cleaner_company: string | null;
  created_by: string | null;
  signed_url: string | null;
};

function formatPeriod(start: string, end: string) {
  const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatMarket(m: string) {
  return { branson: "Branson", deep_creek: "Deep Creek", poconos: "Poconos" }[m] || m;
}

export default function ReportsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState("all");
  const [generating, setGenerating] = useState(false);
  const [showGenModal, setShowGenModal] = useState(false);
  const [genMarket, setGenMarket] = useState("branson");
  const [genStart, setGenStart] = useState("");
  const [genEnd, setGenEnd] = useState("");
  const [genResult, setGenResult] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Read role from ops_ui cookie (non-HttpOnly)
  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)ops_ui=([^;]+)/);
    if (match) {
      try {
        const u = JSON.parse(decodeURIComponent(match[1]));
        setUserRole(u.role || null);
      } catch { /* ignore */ }
    }
  }, []);

  // Default gen dates to last full month
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
    const params = new URLSearchParams();
    if (market !== "all") params.set("market", market);
    const res = await fetch(`/api/reports?${params}`);
    if (res.status === 401) { router.push("/login"); return; }
    const json = await res.json();
    setRows(json.rows || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [market]);

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

  // Group rows by period_start for display
  const grouped = useMemo(() => {
    const map: Record<string, ReportRow[]> = {};
    for (const r of rows) {
      if (!map[r.period_start]) map[r.period_start] = [];
      map[r.period_start].push(r);
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

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

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 16px" }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>Cleaner Performance Reports</h1>
          <div style={{ flex: 1 }} />
          {/* Market filter — only for non-vendor */}
          {userRole !== "vendor" && (
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, background: "#fff", color: "#374151" }}
            >
              {MARKET_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          )}
          {userRole === "admin" && (
            <button
              onClick={() => { setShowGenModal(true); setGenResult(null); }}
              style={{ padding: "7px 16px", background: "#1a7a3c", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              + Generate Report
            </button>
          )}
        </div>

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
            No reports yet.{userRole === "admin" ? ` Click "Generate Report" to create your first one.` : " Check back after reports are published."}
          </div>
        ) : (
          grouped.map(([periodStart, periodRows]) => (
            <div key={periodStart} style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", letterSpacing: "0.06em", marginBottom: 10, textTransform: "uppercase" }}>
                {formatPeriod(periodStart, periodRows[0].period_end)}
              </div>
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                {periodRows.map((row, i) => (
                  <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 18px", borderTop: i > 0 ? "1px solid #f3f4f6" : "none" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", marginBottom: 2 }}>
                        {row.cleaner_company || "Portfolio"}
                      </div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>
                        {formatMarket(row.market)} · Generated {new Date(row.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    </div>
                    {row.signed_url ? (
                      <a
                        href={row.signed_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ padding: "6px 14px", background: "#f0fdf4", color: "#1a7a3c", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
                      >
                        View Report ↗
                      </a>
                    ) : (
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>Unavailable</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4, marginTop: 14 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, color: "#111827", background: "#fff" };
