"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

type PropertyRow = {
  market: string;
  property: string;
  tomorrow: string;
  open_tasks: number;
  urgent_count: number;
  urgent_titles: string | null;
  avg_review: number | null;
  billable_30d: number | null;
  last_visit: string | null;
  maintenance_tasks: string | null;
};

type Task = { title: string; daysOld: string; url: string };

function parseTasks(raw: string | null): Task[] {
  if (!raw) return [];
  return raw.split("\n").map(line => {
    const parts = line.split(" | ");
    return { title: parts[0] || "", daysOld: parts[1] || "", url: parts[2] || "" };
  }).filter(t => t.title);
}

const DAY_TYPE_LABELS: Record<string, string> = {
  vacant: "Vacant",
  checkin: "Check-in",
  checkout: "Check-out",
  turn: "Turn",
  guest_occupied: "Occupied",
  owner_occupied: "Owner",
};
const DAY_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  vacant:         { bg: "#f1f5f9", text: "#64748b" },
  checkin:        { bg: "#dcfce7", text: "#16a34a" },
  checkout:       { bg: "#dbeafe", text: "#1d4ed8" },
  turn:           { bg: "#fed7aa", text: "#c2410c" },
  guest_occupied: { bg: "#ede9fe", text: "#7c3aed" },
  owner_occupied: { bg: "#fef9c3", text: "#92400e" },
};

const MARKET_OPTIONS = [
  { key: "all", label: "All Markets" },
  { key: "branson", label: "Branson" },
  { key: "deep_creek", label: "Deep Creek" },
  { key: "poconos", label: "Poconos" },
];
const MARKET_LABELS: Record<string, string> = { branson: "Branson", deep_creek: "Deep Creek", poconos: "Poconos" };

const OCCUPANCY_OPTIONS = [
  { key: "all", label: "All Occupancy" },
  { key: "vacant", label: "Vacant" },
  { key: "checkin", label: "Check-in" },
  { key: "checkout", label: "Check-out" },
  { key: "turn", label: "Turn" },
  { key: "guest_occupied", label: "Occupied" },
  { key: "owner_occupied", label: "Owner" },
];

function isoToday() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function isoTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
function isoMax() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}
function fmtDate(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

type SortKey = "property" | "market" | "open_tasks" | "urgent_count" | "avg_review" | "billable_30d";

export default function MaintenancePage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<{ name: string; role: string } | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [market, setMarket] = useState("all");
  const [property, setProperty] = useState("all");
  const [occupancy, setOccupancy] = useState("all");
  const [date, setDate] = useState(isoTomorrow());

  const [sortKey, setSortKey] = useState<SortKey>("open_tasks");
  const [sortAsc, setSortAsc] = useState(false);

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Auth
  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)ops_ui=([^;]+)/);
    if (match) {
      try {
        const u = JSON.parse(decodeURIComponent(match[1]));
        if (u.role === "vendor") { router.replace("/"); return; }
        setCurrentUser({ name: u.name || "", role: u.role || "" });
      } catch { router.replace("/login"); }
    } else {
      router.replace("/login");
    }
  }, [router]);

  // Close user menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Fetch data when date changes
  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    fetch(`/api/maintenance?date=${date}`)
      .then(r => r.json())
      .then(j => {
        if (j.error) { setError(j.error); setRows([]); }
        else setRows(j.rows || []);
      })
      .catch(() => setError("Failed to load data"))
      .finally(() => setLoading(false));
  }, [date, currentUser]);

  // Property options from current market filter
  const propertyOptions = useMemo(() => {
    const filtered = market === "all" ? rows : rows.filter(r => r.market === market);
    const names = Array.from(new Set(filtered.map(r => r.property))).sort();
    return [{ key: "all", label: "All Properties" }, ...names.map(n => ({ key: n, label: n }))];
  }, [rows, market]);

  // Reset property when market changes
  useEffect(() => { setProperty("all"); }, [market]);

  // Filtered + sorted rows
  const displayed = useMemo(() => {
    let out = rows;
    if (market !== "all") out = out.filter(r => r.market === market);
    if (property !== "all") out = out.filter(r => r.property === property);
    if (occupancy !== "all") out = out.filter(r => r.tomorrow === occupancy);
    out = [...out].sort((a, b) => {
      let av: string | number = 0, bv: string | number = 0;
      if (sortKey === "property") { av = a.property; bv = b.property; }
      else if (sortKey === "market") { av = a.market; bv = b.market; }
      else if (sortKey === "open_tasks") { av = a.open_tasks; bv = b.open_tasks; }
      else if (sortKey === "urgent_count") { av = a.urgent_count; bv = b.urgent_count; }
      else if (sortKey === "avg_review") { av = a.avg_review ?? -1; bv = b.avg_review ?? -1; }
      else if (sortKey === "billable_30d") { av = a.billable_30d ?? -1; bv = b.billable_30d ?? -1; }
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return a.property.localeCompare(b.property);
    });
    return out;
  }, [rows, market, property, occupancy, sortKey, sortAsc]);

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortAsc(v => !v);
    else { setSortKey(k); setSortAsc(false); }
  }

  function toggleExpand(key: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  function Th({ k, label, right = true }: { k: SortKey; label: string; right?: boolean }) {
    const active = sortKey === k;
    return (
      <th onClick={() => handleSort(k)} style={{
        padding: "10px 14px", textAlign: right ? "right" : "left", fontSize: 10, fontWeight: 600,
        color: active ? "#ffffff" : "#64748b", letterSpacing: "0.06em", textTransform: "uppercase",
        cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", background: "#1e293b",
      }}>
        {label}{active ? (sortAsc ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  const totalOpen = displayed.reduce((s, r) => s + r.open_tasks, 0);
  const totalUrgent = displayed.reduce((s, r) => s + r.urgent_count, 0);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6f9", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#1a202c" }}>

      {/* Nav */}
      <nav style={{ background: "#1e293b", borderBottom: "1px solid #334155", padding: "0 24px", display: "flex", alignItems: "center", height: 52 }}>
        <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", marginRight: 28 }}>
          <span style={{ color: "#ffffff" }}>Vistas</span> Ops
        </span>
        <a href="/" style={{ fontSize: 13, fontWeight: 500, color: "#94a3b8", textDecoration: "none", padding: "0 14px", height: 52, display: "flex", alignItems: "center", borderBottom: "2px solid transparent" }}>
          Cleaning
        </a>
        <a href="/maintenance" style={{ fontSize: 13, fontWeight: 500, color: "#ffffff", textDecoration: "none", padding: "0 14px", height: 52, display: "flex", alignItems: "center", borderBottom: "2px solid #ffffff" }}>
          Maintenance
        </a>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div ref={userMenuRef} style={{ position: "relative" }}>
            <button onClick={() => setShowUserMenu(v => !v)} style={{
              width: 32, height: 32, borderRadius: "50%", border: "none",
              background: currentUser ? "#4f7c6b" : "#334155",
              color: "#ffffff", fontWeight: 700, fontSize: 12, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {currentUser
                ? currentUser.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              }
            </button>
            {showUserMenu && (
              <div style={{
                position: "absolute", top: "calc(100% + 8px)", right: 0, width: 200,
                background: "#ffffff", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                border: "1px solid #e5e7eb", zIndex: 200, overflow: "hidden",
              }}>
                {currentUser && (
                  <div style={{ padding: "12px 14px", borderBottom: "1px solid #f3f4f6" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{currentUser.name}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "capitalize", marginTop: 2 }}>{currentUser.role}</div>
                  </div>
                )}
                <button onClick={logout} style={{ width: "100%", padding: "10px 14px", border: "none", background: "none", textAlign: "left", fontSize: 13, color: "#dc2626", cursor: "pointer", fontWeight: 500 }}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Sub-toolbar */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e2e8f0", padding: "0 24px", display: "flex", alignItems: "center", height: 44, gap: 8 }}>
        {/* Market */}
        <select value={market} onChange={e => setMarket(e.target.value)} style={{ fontSize: 13, fontWeight: 500, border: "1px solid #e2e8f0", borderRadius: 6, padding: "5px 10px", color: "#1a202c", background: "#ffffff", cursor: "pointer", outline: "none" }}>
          {MARKET_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>

        {/* Property */}
        <select value={property} onChange={e => setProperty(e.target.value)} style={{ fontSize: 13, fontWeight: 500, border: "1px solid #e2e8f0", borderRadius: 6, padding: "5px 10px", color: "#1a202c", background: "#ffffff", cursor: "pointer", outline: "none", maxWidth: 220 }}>
          {propertyOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>

        {/* Occupancy */}
        <select value={occupancy} onChange={e => setOccupancy(e.target.value)} style={{ fontSize: 13, fontWeight: 500, border: "1px solid #e2e8f0", borderRadius: 6, padding: "5px 10px", color: "#1a202c", background: "#ffffff", cursor: "pointer", outline: "none" }}>
          {OCCUPANCY_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>

        <div style={{ flex: 1 }} />

        {/* Date picker */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>Date</span>
          <input
            type="date"
            value={date}
            min={isoToday()}
            max={isoMax()}
            onChange={e => setDate(e.target.value)}
            style={{ fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 6, padding: "5px 10px", color: "#1a202c", background: "#ffffff", outline: "none", cursor: "pointer" }}
          />
          {date !== isoTomorrow() && (
            <button onClick={() => setDate(isoTomorrow())} style={{ fontSize: 12, padding: "5px 10px", border: "1px solid #e2e8f0", borderRadius: 6, background: "transparent", color: "#64748b", cursor: "pointer" }}>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 1500, margin: "0 auto", padding: "24px 28px" }}>

        {/* Page heading + summary chips */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1a202c" }}>Property Maintenance</h1>
            <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "#6b7280" }}>
              Open maintenance tasks by property for {fmtDate(date)}.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
            <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500 }}>Properties</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "#1a202c" }}>{displayed.length}</span>
            </div>
            <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500 }}>Open Tasks</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: totalOpen > 0 ? "#dc2626" : "#1a202c" }}>{totalOpen}</span>
            </div>
            {totalUrgent > 0 && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "#dc2626", fontWeight: 500 }}>Urgent</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: "#dc2626" }}>{totalUrgent}</span>
              </div>
            )}
          </div>
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8", fontSize: 14 }}>Loading...</div>
        )}
        {error && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#dc2626", fontSize: 14 }}>{error}</div>
        )}

        {!loading && !error && (
          <div style={{ background: "#ffffff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <Th k="property" label="Property" right={false} />
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase", background: "#1e293b", whiteSpace: "nowrap" }}>Occupancy</th>
                    <Th k="open_tasks" label="Open" />
                    <Th k="urgent_count" label="Urgent" />
                    <Th k="avg_review" label="Avg Review" />
                    <Th k="billable_30d" label="Hrs (30d)" />
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase", background: "#1e293b", whiteSpace: "nowrap" }}>Last Visit</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase", background: "#1e293b", whiteSpace: "nowrap" }}>Tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                        No properties match the current filters.
                      </td>
                    </tr>
                  )}
                  {displayed.map((row, i) => {
                    const key = `${row.market}:${row.property}`;
                    const tasks = parseTasks(row.maintenance_tasks);
                    const expanded = expandedRows.has(key);
                    const occ = DAY_TYPE_COLORS[row.tomorrow] || { bg: "#f1f5f9", text: "#64748b" };
                    return (
                      <tr key={key} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#ffffff" : "#fafbfc" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#f8faff")}
                        onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "#ffffff" : "#fafbfc")}
                      >
                        {/* Property */}
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                          <div style={{ fontWeight: 600, color: "#1a202c", fontSize: 13 }}>{row.property}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{MARKET_LABELS[row.market] || row.market}</div>
                        </td>

                        {/* Occupancy */}
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                          <span style={{ display: "inline-block", background: occ.bg, color: occ.text, fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 10 }}>
                            {DAY_TYPE_LABELS[row.tomorrow] || row.tomorrow}
                          </span>
                        </td>

                        {/* Open tasks */}
                        <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: row.open_tasks > 0 ? "#dc2626" : "#94a3b8", fontSize: 14 }}>
                          {row.open_tasks > 0 ? row.open_tasks : "—"}
                        </td>

                        {/* Urgent */}
                        <td style={{ padding: "10px 14px", textAlign: "right" }}>
                          {row.urgent_count > 0 ? (
                            <span style={{ display: "inline-block", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>
                              {row.urgent_count} urgent
                            </span>
                          ) : <span style={{ color: "#94a3b8" }}>—</span>}
                        </td>

                        {/* Avg review */}
                        <td style={{ padding: "10px 14px", textAlign: "right", color: row.avg_review != null ? (row.avg_review >= 4.7 ? "#16a34a" : row.avg_review >= 4.0 ? "#d97706" : "#dc2626") : "#94a3b8", fontWeight: row.avg_review != null ? 600 : 400, fontSize: 13 }}>
                          {row.avg_review != null ? row.avg_review.toFixed(2) : "—"}
                        </td>

                        {/* Billable 30d */}
                        <td style={{ padding: "10px 14px", textAlign: "right", color: row.billable_30d != null ? "#1a202c" : "#94a3b8", fontSize: 13 }}>
                          {row.billable_30d != null ? `${row.billable_30d}h` : "—"}
                        </td>

                        {/* Last visit */}
                        <td style={{ padding: "10px 14px", color: "#4b5563", fontSize: 12, maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {row.last_visit || <span style={{ color: "#94a3b8" }}>—</span>}
                        </td>

                        {/* Tasks */}
                        <td style={{ padding: "10px 14px", maxWidth: 340 }}>
                          {tasks.length === 0 ? (
                            <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
                          ) : (
                            <div>
                              {(expanded ? tasks : tasks.slice(0, 2)).map((t, ti) => (
                                <div key={ti} style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: ti < tasks.length - 1 ? 4 : 0 }}>
                                  <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.4, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                                  <span style={{ fontSize: 10, color: "#94a3b8", whiteSpace: "nowrap", flexShrink: 0 }}>{t.daysOld}</span>
                                  {t.url && (
                                    <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#3b82f6", whiteSpace: "nowrap", flexShrink: 0, textDecoration: "none" }}>↗</a>
                                  )}
                                </div>
                              ))}
                              {tasks.length > 2 && (
                                <button onClick={() => toggleExpand(key)} style={{ fontSize: 11, color: "#3b82f6", background: "none", border: "none", padding: "2px 0 0 0", cursor: "pointer", fontWeight: 500 }}>
                                  {expanded ? "Show less" : `+${tasks.length - 2} more`}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
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
