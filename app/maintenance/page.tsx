"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

const PropertyMap = dynamic(() => import("./PropertyMap"), { ssr: false, loading: () => (
  <div style={{ height: 340, borderRadius: 10, background: "#f1f5f9", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>Loading map…</div>
) });

const ScheduleModal = dynamic(() => import("./ScheduleModal"), { ssr: false });
const RoutesPanel = dynamic(() => import("./RoutesPanel"), { ssr: false });

type PropertyRow = {
  market: string;
  property: string;
  tomorrow: string;
  check_in_date: string | null;
  check_out_date: string | null;
  lat: number | null;
  lng: number | null;
  open_tasks: number;
  urgent_count: number;
  urgent_titles: string | null;
  avg_review: number | null;
  timesheet_30d: string | null;
  maintenance_tasks: string | null;
  completed_tasks: string | null;
};

// Open task format: "title | Xd old | url | priority | assignee"
type OpenTask = { title: string; daysOld: string; daysNum: number; url: string; urgent: boolean; assignee: string };
// Completed task format: "title | url"
type DoneTask = { title: string; url: string };

function parseOpenTasks(raw: string | null): OpenTask[] {
  if (!raw) return [];
  return raw.split("\n").map(line => {
    const parts = line.split(" | ");
    const daysOld = parts[1] || "";
    const daysNum = parseInt(daysOld) || 0;
    return {
      title: parts[0] || "",
      daysOld,
      daysNum,
      url: parts[2] || "",
      urgent: (parts[3] || "") === "urgent",
      assignee: parts[4] || "Unassigned",
    };
  }).filter(t => t.title);
}

function parseDoneTasks(raw: string | null): DoneTask[] {
  if (!raw) return [];
  return raw.split("\n").map(line => {
    const parts = line.split(" | ");
    return { title: parts[0] || "", url: parts[1] || "" };
  }).filter(t => t.title);
}

function parseTimesheetEntries(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split("\n").filter(Boolean);
}

const DAY_TYPE_LABELS: Record<string, string> = {
  vacant: "Vacant", checkin: "Check-in", checkout: "Check-out",
  turn: "Turn", guest_occupied: "Occupied", owner_occupied: "Owner",
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
  { key: "branson",    label: "Branson" },
  { key: "deep_creek", label: "Deep Creek" },
  { key: "poconos",   label: "Poconos" },
];
const MARKET_LABELS: Record<string, string> = { branson: "Branson", deep_creek: "Deep Creek", poconos: "Poconos" };

const OCCUPANCY_OPTIONS = [
  { key: "vacant",         label: "Vacant" },
  { key: "checkin",        label: "Check-in" },
  { key: "checkout",       label: "Check-out" },
  { key: "turn",           label: "Turn" },
  { key: "guest_occupied", label: "Occupied" },
  { key: "owner_occupied", label: "Owner" },
];

function localIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoToday()    { return localIso(new Date()); }
function isoTomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return localIso(d); }
function isoMax()      { const d = new Date(); d.setDate(d.getDate() + 14); return localIso(d); }
function fmtDate(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function fmtShortDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function occupancyDateLabel(type: string, checkIn: string | null, checkOut: string | null): string | null {
  switch (type) {
    case "checkin":
    case "turn":
      return checkIn ? `Check-in ${fmtShortDate(checkIn)}` : null;
    case "vacant":
    case "checkout":
      // check_in_date is pre-populated by SQL with next upcoming check-in date
      return checkIn ? `Check-in ${fmtShortDate(checkIn)}` : "Check-in > 14 days";
    case "guest_occupied":
    case "owner_occupied":
      return checkOut ? `Out ${fmtShortDate(checkOut)}` : null;
    default:
      return null;
  }
}

const ACCESSIBLE_TYPES = new Set(["vacant", "checkin", "checkout", "turn"]);

function daysUntilCheckin(checkInIso: string | null): number | null {
  if (!checkInIso) return null;
  const target = new Date(checkInIso + "T12:00:00Z");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function checkinPillStyle(days: number): { bg: string; text: string; border: string } {
  if (days <= 1)  return { bg: "#fef2f2", text: "#dc2626", border: "#fecaca" };
  if (days <= 3)  return { bg: "#fff7ed", text: "#c2410c", border: "#fed7aa" };
  if (days <= 7)  return { bg: "#fefce8", text: "#92400e", border: "#fde68a" };
  return           { bg: "#f0f9ff", text: "#0369a1", border: "#bae6fd" };
}

type SortKey = "property" | "market" | "open_tasks" | "urgent_count" | "avg_review";

// ─── Multi-select dropdown ────────────────────────────────────────────────────
function MultiSelect({ options, selected, onChange, placeholder, groups }: {
  options: { key: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  placeholder: string;
  groups?: { label: string; members: string[] }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const allSelected = selected.size === 0;
  const label = allSelected
    ? placeholder
    : selected.size === 1
      ? options.find(o => selected.has(o.key))?.label ?? placeholder
      : `${selected.size} selected`;

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  }

  function toggleGroup(members: string[]) {
    const allIn = members.every(m => selected.has(m));
    const next = new Set(selected);
    if (allIn) { members.forEach(m => next.delete(m)); }
    else { members.forEach(m => next.add(m)); }
    onChange(next);
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(v => !v)} style={{
        display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500,
        border: "1px solid #e2e8f0", borderRadius: 6, padding: "5px 10px",
        color: allSelected ? "#6b7280" : "#1a202c", background: "#ffffff",
        cursor: "pointer", outline: "none", whiteSpace: "nowrap", minWidth: 130,
      }}>
        <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100,
          background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.1)", minWidth: 180, overflow: "hidden",
        }}>
          <button onClick={() => onChange(new Set())} style={{
            width: "100%", padding: "8px 12px", textAlign: "left", fontSize: 12,
            fontWeight: allSelected ? 600 : 400, color: allSelected ? "#1a202c" : "#6b7280",
            background: allSelected ? "#f8fafc" : "transparent", border: "none",
            borderBottom: "1px solid #e2e8f0", cursor: "pointer",
          }}>
            {placeholder} {allSelected && "✓"}
          </button>
          {groups && groups.map(g => {
            const allIn = g.members.every(m => selected.has(m));
            return (
              <button key={g.label} onClick={() => toggleGroup(g.members)} style={{
                width: "100%", padding: "8px 12px", textAlign: "left", fontSize: 12,
                fontWeight: allIn ? 600 : 500, color: allIn ? "#1d4ed8" : "#374151",
                background: allIn ? "#eff6ff" : "#f8fafc", border: "none",
                borderBottom: "1px solid #e2e8f0", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                {g.label}
                {allIn && <span style={{ color: "#3b82f6", fontSize: 11 }}>✓</span>}
              </button>
            );
          })}
          {options.map(o => (
            <button key={o.key} onClick={() => toggle(o.key)} style={{
              width: "100%", padding: "8px 12px", textAlign: "left", fontSize: 12,
              fontWeight: selected.has(o.key) ? 600 : 400,
              color: selected.has(o.key) ? "#1a202c" : "#4b5563",
              background: selected.has(o.key) ? "#f0f9ff" : "transparent",
              border: "none", borderBottom: "1px solid #f9fafb", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              {o.label}
              {selected.has(o.key) && <span style={{ color: "#3b82f6", fontSize: 11 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MaintenancePage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<{ name: string; role: string } | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [markets, setMarkets] = useState<Set<string>>(new Set());
  const [properties, setProperties] = useState<Set<string>>(new Set());
  const [occupancies, setOccupancies] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(isoTomorrow());

  const [sortKey, setSortKey] = useState<SortKey>("urgent_count");
  const [sortAsc, setSortAsc] = useState(false);

  const [mapFocus, setMapFocus] = useState<{ lat: number; lng: number } | null>(null);
  const [scheduleRow, setScheduleRow] = useState<PropertyRow | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [showRoutes, setShowRoutes] = useState(false);

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

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    setProperties(new Set());
    fetch(`/api/maintenance?date=${date}`)
      .then(r => r.json())
      .then(j => { if (j.error) { setError(j.error); setRows([]); } else setRows(j.rows || []); })
      .catch(() => setError("Failed to load data"))
      .finally(() => setLoading(false));
  }, [date, currentUser]);

  const propertyOptions = useMemo(() => {
    const filtered = markets.size === 0 ? rows : rows.filter(r => markets.has(r.market));
    return Array.from(new Set(filtered.map(r => r.property))).sort().map(n => ({ key: n, label: n }));
  }, [rows, markets]);

  useEffect(() => { setProperties(new Set()); setShowMap(true); }, [markets]);

  const displayed = useMemo(() => {
    let out = rows;
    if (markets.size > 0) out = out.filter(r => markets.has(r.market));
    if (properties.size > 0) out = out.filter(r => properties.has(r.property));
    if (occupancies.size > 0) out = out.filter(r => occupancies.has(r.tomorrow));
    return [...out].sort((a, b) => {
      let av: string | number = 0, bv: string | number = 0;
      if (sortKey === "property")     { av = a.property; bv = b.property; }
      else if (sortKey === "market")  { av = a.market; bv = b.market; }
      else if (sortKey === "open_tasks")    { av = a.open_tasks; bv = b.open_tasks; }
      else if (sortKey === "urgent_count")  { av = a.urgent_count; bv = b.urgent_count; }
      else if (sortKey === "avg_review")    { av = a.avg_review ?? -1; bv = b.avg_review ?? -1; }
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return a.property.localeCompare(b.property);
    });
  }, [rows, markets, properties, occupancies, sortKey, sortAsc]);

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortAsc(v => !v); else { setSortKey(k); setSortAsc(false); }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const thBase: React.CSSProperties = {
    padding: "10px 14px", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
    textTransform: "uppercase", background: "#1e293b", whiteSpace: "nowrap",
    userSelect: "none", position: "sticky", top: 0, zIndex: 2, color: "#64748b",
  };

  function Th({ k, label, right = true }: { k: SortKey; label: string; right?: boolean }) {
    const active = sortKey === k;
    return (
      <th onClick={() => handleSort(k)} style={{ ...thBase, textAlign: right ? "right" : "left", cursor: "pointer", color: active ? "#ffffff" : "#64748b" }}>
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
        <a href="/" style={{ fontSize: 13, fontWeight: 500, color: "#94a3b8", textDecoration: "none", padding: "0 14px", height: 52, display: "flex", alignItems: "center", borderBottom: "2px solid transparent" }}>Cleaning</a>
        <a href="/maintenance" style={{ fontSize: 13, fontWeight: 500, color: "#ffffff", textDecoration: "none", padding: "0 14px", height: 52, display: "flex", alignItems: "center", borderBottom: "2px solid #ffffff" }}>Maintenance</a>
        <div style={{ flex: 1 }} />
        <div ref={userMenuRef} style={{ position: "relative" }}>
          <button onClick={() => setShowUserMenu(v => !v)} style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: currentUser ? "#4f7c6b" : "#334155", color: "#ffffff", fontWeight: 700, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {currentUser ? currentUser.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase() : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>}
          </button>
          {showUserMenu && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 200, background: "#ffffff", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.15)", border: "1px solid #e5e7eb", zIndex: 200, overflow: "hidden" }}>
              {currentUser && (
                <div style={{ padding: "12px 14px", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{currentUser.name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "capitalize", marginTop: 2 }}>{currentUser.role}</div>
                </div>
              )}
              <button onClick={logout} style={{ width: "100%", padding: "10px 14px", border: "none", background: "none", textAlign: "left", fontSize: 13, color: "#dc2626", cursor: "pointer", fontWeight: 500 }}>Sign out</button>
            </div>
          )}
        </div>
      </nav>

      {/* Sub-toolbar */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e2e8f0", padding: "0 24px", display: "flex", alignItems: "center", height: 44, gap: 8 }}>
        <MultiSelect options={MARKET_OPTIONS} selected={markets} onChange={setMarkets} placeholder="All Markets" />
        <MultiSelect options={propertyOptions} selected={properties} onChange={setProperties} placeholder="All Properties" />
        <MultiSelect
          options={OCCUPANCY_OPTIONS}
          selected={occupancies}
          onChange={setOccupancies}
          placeholder="All Occupancy"
          groups={[{ label: "Accessible", members: ["vacant", "checkin", "checkout", "turn"] }]}
        />
        <div style={{ flex: 1 }} />
        {markets.size === 1 && (
          <button
            onClick={() => setShowMap(v => !v)}
            style={{
              fontSize: 12, fontWeight: 500, padding: "5px 10px",
              border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer",
              background: showMap ? "#1e293b" : "#ffffff",
              color: showMap ? "#ffffff" : "#64748b",
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <span>🗺️</span> {showMap ? "Hide Map" : "Show Map"}
          </button>
        )}
        <button
          onClick={() => setShowRoutes(v => !v)}
          style={{
            fontSize: 12, fontWeight: 500, padding: "5px 10px",
            border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer",
            background: showRoutes ? "#1e293b" : "#ffffff",
            color: showRoutes ? "#ffffff" : "#64748b",
            display: "flex", alignItems: "center", gap: 5,
          }}
        >
          <span>🗂️</span> Routes
        </button>
        <span style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>Date</span>
        <input type="date" value={date} min={isoToday()} max={isoMax()} onChange={e => e.target.value && setDate(e.target.value)}
          style={{ fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 6, padding: "5px 10px", color: "#1a202c", background: "#ffffff", outline: "none", cursor: "pointer" }} />
        {date !== isoTomorrow() && (
          <button onClick={() => setDate(isoTomorrow())} style={{ fontSize: 12, padding: "5px 10px", border: "1px solid #e2e8f0", borderRadius: 6, background: "transparent", color: "#64748b", cursor: "pointer" }}>Tomorrow</button>
        )}
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 1600, margin: "0 auto", display: "flex", alignItems: "flex-start" }}>

      {/* Left: map + table */}
      <div style={{ flex: 1, minWidth: 0, padding: "24px 28px" }}>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1a202c" }}>Property Maintenance</h1>
            <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "#6b7280" }}>Open maintenance tasks by property for {fmtDate(date)}.</p>
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

        {/* Map — visible when exactly one market is selected and not toggled off */}
        {!loading && !error && markets.size === 1 && showMap && (
          <PropertyMap
            rows={displayed}
            market={Array.from(markets)[0]}
            focusProp={mapFocus}
          />
        )}

        {loading && <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8", fontSize: 14 }}>Loading...</div>}
        {error && <div style={{ textAlign: "center", padding: "60px 0", color: "#dc2626", fontSize: 14 }}>{error}</div>}

        {!loading && !error && (
          <div style={{ background: "#ffffff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <Th k="property" label="Property" right={false} />
                    <th style={{ ...thBase, textAlign: "left" }}>Occupancy</th>
                    <Th k="open_tasks" label="Open" />
                    <Th k="urgent_count" label="Urgent" />
                    <Th k="avg_review" label="Avg Review" />
                    <th style={{ ...thBase, textAlign: "left", minWidth: 200 }}>Timesheet App 30d</th>
                    <th style={{ ...thBase, textAlign: "left", width: 260, minWidth: 160, maxWidth: 260 }}>Open Tasks</th>
                    <th style={{ ...thBase, textAlign: "left", width: 220, minWidth: 140, maxWidth: 220 }}>Completed Tasks 30d</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.length === 0 && (
                    <tr><td colSpan={8} style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No properties match the current filters.</td></tr>
                  )}
                  {displayed.map((row, i) => {
                    const key = `${row.market}:${row.property}`;
                    const openTasks = parseOpenTasks(row.maintenance_tasks);
                    const doneTasks = parseDoneTasks(row.completed_tasks);
                    const timesheetEntries = parseTimesheetEntries(row.timesheet_30d);
                    const occ = DAY_TYPE_COLORS[row.tomorrow] || { bg: "#f1f5f9", text: "#64748b" };
                    const isDeepCreek = row.market === "deep_creek";
                    const occDateLabel = occupancyDateLabel(row.tomorrow, row.check_in_date, row.check_out_date);
                    const isOwner = row.tomorrow === "owner_occupied";
                    const checkinDays = daysUntilCheckin(row.check_in_date);
                    const showCheckinPill = checkinDays !== null && row.open_tasks > 0;

                    return (
                      <tr key={key}
                        style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#ffffff" : "#fafbfc", verticalAlign: "top" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#f8faff")}
                        onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "#ffffff" : "#fafbfc")}
                      >
                        {/* Property */}
                        <td style={{ padding: "10px 14px", width: 210, maxWidth: 210 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            {row.lat != null && row.lng != null && markets.size === 1 && (
                              <button
                                onClick={() => setMapFocus({ lat: row.lat!, lng: row.lng! })}
                                title="Show on map"
                                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1, flexShrink: 0 }}
                              >🗺️</button>
                            )}
                            <div style={{ fontWeight: 600, color: "#1a202c", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={row.property}>{row.property}</div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                            <div style={{ fontSize: 11, color: "#94a3b8" }}>{MARKET_LABELS[row.market] || row.market}</div>
                            {openTasks.length > 0 && (
                              <button
                                onClick={() => setScheduleRow(row)}
                                style={{
                                  fontSize: 10, fontWeight: 600, padding: "2px 7px",
                                  background: "#eff6ff", color: "#1d4ed8",
                                  border: "1px solid #bfdbfe", borderRadius: 8,
                                  cursor: "pointer", whiteSpace: "nowrap",
                                }}
                              >Schedule</button>
                            )}
                          </div>
                        </td>

                        {/* Occupancy */}
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ display: "inline-block", background: occ.bg, color: occ.text, fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 10 }}>
                              {DAY_TYPE_LABELS[row.tomorrow] || row.tomorrow}
                            </span>
                            {isOwner && (
                              <span title="Owner stay" style={{ fontSize: 13 }}>🏠</span>
                            )}
                          </div>
                          {occDateLabel && (
                            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{occDateLabel}</div>
                          )}
                        </td>

                        {/* Open count */}
                        <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: row.open_tasks > 0 ? "#dc2626" : "#94a3b8", fontSize: 14 }}>
                          {row.open_tasks > 0 ? row.open_tasks : "—"}
                        </td>

                        {/* Urgent count */}
                        <td style={{ padding: "10px 14px", textAlign: "right" }}>
                          {row.urgent_count > 0
                            ? <span style={{ display: "inline-block", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>{row.urgent_count} urgent</span>
                            : <span style={{ color: "#94a3b8" }}>—</span>}
                        </td>

                        {/* Avg review */}
                        <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: row.avg_review != null ? 600 : 400, fontSize: 13, color: row.avg_review != null ? (row.avg_review >= 4.7 ? "#16a34a" : row.avg_review >= 4.0 ? "#d97706" : "#dc2626") : "#94a3b8" }}>
                          {row.avg_review != null ? row.avg_review.toFixed(2) : "—"}
                        </td>

                        {/* Timesheet 30d — Deep Creek only */}
                        <td style={{ padding: "10px 14px", minWidth: 200 }}>
                          {!isDeepCreek
                            ? <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
                            : timesheetEntries.length === 0
                              ? <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
                              : timesheetEntries.map((entry, ei) => (
                                <div key={ei} style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, marginBottom: ei < timesheetEntries.length - 1 ? 4 : 0 }}>
                                  {entry}
                                </div>
                              ))}
                        </td>

                        {/* Open Tasks (with warning icon + red age) */}
                        <td style={{ padding: "10px 14px", width: 260, maxWidth: 260 }}>
                          {showCheckinPill && (() => {
                            const ps = checkinPillStyle(checkinDays!);
                            const label = checkinDays === 0 ? "Check-in today"
                              : checkinDays === 1 ? "Check-in tomorrow"
                              : `Check-in in ${checkinDays} days`;
                            return (
                              <div style={{ display: "inline-block", background: ps.bg, color: ps.text, border: `1px solid ${ps.border}`, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, marginBottom: 6 }}>
                                {label}
                              </div>
                            );
                          })()}
                          {openTasks.length === 0
                            ? <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
                            : openTasks.map((t, ti) => (
                              <div key={ti} style={{ display: "flex", alignItems: "baseline", gap: 5, marginBottom: ti < openTasks.length - 1 ? 5 : 0 }}>
                                {t.urgent && <span style={{ fontSize: 12, flexShrink: 0, lineHeight: 1 }}>⚠️</span>}
                                <span style={{ fontSize: 12, color: "#374151", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.title}>{t.title}</span>
                                <span style={{ fontSize: 10, whiteSpace: "nowrap", flexShrink: 0, color: t.daysNum >= 7 ? "#dc2626" : "#94a3b8", fontWeight: t.daysNum >= 7 ? 600 : 400 }}>{t.daysOld}</span>
                                {t.url && <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#3b82f6", whiteSpace: "nowrap", flexShrink: 0, textDecoration: "none" }}>↗</a>}
                              </div>
                            ))}
                        </td>

                        {/* Completed Tasks */}
                        <td style={{ padding: "10px 14px", width: 220, maxWidth: 220 }}>
                          {doneTasks.length === 0
                            ? <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
                            : doneTasks.map((t, ti) => (
                              <div key={ti} style={{ display: "flex", alignItems: "baseline", gap: 5, marginBottom: ti < doneTasks.length - 1 ? 5 : 0 }}>
                                <span style={{ fontSize: 12, color: "#374151", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.title}>{t.title}</span>
                                {t.url && <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#3b82f6", whiteSpace: "nowrap", flexShrink: 0, textDecoration: "none" }}>↗</a>}
                              </div>
                            ))}
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
      {/* End left panel */}

      {/* Right: routes panel */}
      {showRoutes && (
        <div style={{
          width: "25%", minWidth: 260, maxWidth: 380, flexShrink: 0,
          position: "sticky", top: 96, height: "calc(100vh - 96px)",
          borderLeft: "1px solid #e2e8f0", background: "#ffffff",
          display: "flex", flexDirection: "column",
        }}>
          <RoutesPanel displayed={displayed} />
        </div>
      )}

      </div>

      {scheduleRow && (
        <ScheduleModal
          row={scheduleRow}
          date={date}
          onClose={() => setScheduleRow(null)}
        />
      )}
    </div>
  );
}
