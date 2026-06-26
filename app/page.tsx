"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

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
  individual_name: string | null;
  task_title: string | null;
  is_finished: boolean;
  finished_at: string | null;
  finished_cst: { dateStr: string; hour: number; minute: number } | null;
  tz_abbr: string | null;
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
  const headers = ["Sched Date", "Property", "Crew", "Status", "Finished (Local Time)", "On Time?", "Deadline Type", "Deadline", "Duration (min)", "Cleanliness", "Review", "Refund?"];
  const csvRows = [headers, ...tasks.map(t => {
    const abbr = t.tz_abbr || "CT";
    const finishedStr = t.finished_cst ? `${t.finished_cst.dateStr} ${t.finished_cst.hour}:${String(t.finished_cst.minute).padStart(2, "0")} ${abbr}` : "";
    const refundAmt = t.linked_refunds.reduce((s, r) => s + r.refund_amount, 0);
    return [
      t.scheduled_date,
      t.property_name || "",
      t.individual_name || "",
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
  const router = useRouter();

  // Parse logged-in user from session cookie (base64url.sig format set by login API)
  const currentUser = useMemo(() => {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(/(?:^|;\s*)ops_session=([^;]+)/);
    if (!match) return null;
    try {
      const [data] = match[1].split(".");
      return JSON.parse(Buffer.from(data, "base64").toString());
    } catch { return null; }
  }, []);

  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showUserMenu) return;
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showUserMenu]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

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
  const [filterCrew, setFilterCrew] = useState("all");

  // Settings drawer
  const [showSettings, setShowSettings] = useState(false);
  type OpsUser = { id: string; name: string; email: string; role: string; markets: string[] };
  const [opsUsers, setOpsUsers] = useState<OpsUser[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [userForm, setUserForm] = useState<{ name: string; email: string; role: string; markets: string[]; password: string } | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await fetch("/api/users");
      const json = await res.json();
      setOpsUsers(json.users || []);
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => { if (showSettings) loadUsers(); }, [showSettings, loadUsers]);

  async function saveUser() {
    if (!userForm) return;
    const isNew = !editingUserId;
    const payload = { ...userForm };
    if (!payload.password) delete (payload as { password?: string }).password;
    const res = await fetch("/api/users", {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isNew ? payload : { id: editingUserId, ...payload }),
    });
    if (res.ok) { setUserForm(null); setEditingUserId(null); loadUsers(); }
  }

  async function deleteUser(id: string) {
    if (!confirm("Remove this user?")) return;
    await fetch(`/api/users?id=${id}`, { method: "DELETE" });
    loadUsers();
  }

  const MARKET_LABELS: Record<string, string> = { branson: "Branson", deep_creek: "Deep Creek", poconos: "Poconos" };
  const ROLE_COLORS: Record<string, string> = { admin: "#6366f1", employee: "#0ea5e9", vendor: "#64748b" };

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

  const crewOptions = useMemo(() => {
    const names = [
      ...new Set(
        (drillCleaner?.enriched_tasks || [])
          .map((t: EnrichedTask) => t.individual_name)
          .filter(Boolean)
      ),
    ].sort() as string[];
    return [{ key: "all", label: "All Crew" }, ...names.map(n => ({ key: n, label: n }))];
  }, [drillCleaner]);

  // When cleaner dropdown changes, either clear drill-down or open it
  function handleCleanerSelect(name: string) {
    setFilterCleaner(name);
    setFilterCrew("all");
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
    <nav style={{ background: "#1e293b", borderBottom: "1px solid #334155", padding: "0 24px", display: "flex", alignItems: "center", height: 52, gap: 0 }}>
      {drillCleaner ? (
        <button onClick={() => { setDrillCleaner(null); setFilterCleaner("all"); setFilterCrew("all"); }} style={{
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
        <>
          <span style={{ fontWeight: 700, fontSize: 15, color: "#ffffff" }}>{drillCleaner.vendor_name}</span>
          {crewOptions.length > 2 && (
            <>
              <span style={{ width: 1, height: 20, background: "#1e293b", margin: "0 20px", flexShrink: 0 }} />
              <NavSelect value={filterCrew} onChange={setFilterCrew} options={crewOptions} />
            </>
          )}
        </>
      )}
      <div style={{ flex: 1 }} />
      {drillCleaner && (
        <button onClick={() => exportCSV(drillCleaner, meta)} style={{
          padding: "5px 14px", border: "1px solid #334155", borderRadius: 6, background: "transparent",
          color: "#94a3b8", fontSize: 12, fontWeight: 500, cursor: "pointer", marginRight: 8,
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
      <span style={{ width: 1, height: 20, background: "#334155", margin: "0 12px", flexShrink: 0 }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={() => setShowSettings(true)} style={{ padding: 6, border: "none", background: "transparent", color: "#94a3b8", cursor: "pointer", display: "flex", alignItems: "center", lineHeight: 0 }} title="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <div ref={userMenuRef} style={{ position: "relative" }}>
          <button onClick={() => setShowUserMenu(v => !v)} style={{
            width: 32, height: 32, borderRadius: "50%", border: "none",
            background: currentUser ? "#4f7c6b" : "#334155",
            color: "#ffffff", fontWeight: 700, fontSize: 12, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }} title={currentUser?.name || "Account"}>
            {currentUser
              ? currentUser.name.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase()
              : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              )
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
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{currentUser.email}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "capitalize", marginTop: 2 }}>{currentUser.role}</div>
                </div>
              )}
              <button onClick={logout} style={{
                width: "100%", padding: "10px 14px", border: "none", background: "none",
                textAlign: "left", fontSize: 13, color: "#dc2626", cursor: "pointer", fontWeight: 500,
              }}>Sign out</button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );

  // ─── Drill-down view ──────────────────────────────────────────────────────────

  if (drillCleaner) {
    const c = drillCleaner;
    const allTasks = (c.enriched_tasks || []).sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
    const tasks = filterCrew === "all" ? allTasks : allTasks.filter(t => t.individual_name === filterCrew);
    const dateLabel = meta ? `${fmtDate(meta.fromDate)} → ${fmtDate(meta.toDate)}` : "";

    function Chip({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
      return (
        <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500 }}>{label}</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: color || "#1a202c" }}>{value}</span>
        </div>
      );
    }

    const totalRefundAmt = tasks.flatMap(t => t.linked_refunds).reduce((s, r) => s + r.refund_amount, 0);

    // Recompute KPI stats from the (possibly crew-filtered) task list
    const kpiCleans = tasks.length;
    const kpiDecided = tasks.filter(t => t.decided).length;
    const kpiOnTime = tasks.filter(t => t.decided && t.on_time).length;
    const kpiOnTimeRate = kpiDecided > 0 ? kpiOnTime / kpiDecided : null;
    const kpiOverdue = tasks.filter(t => t.clean_status === "Overdue").length;
    const kpiProperties = new Set(tasks.map(t => t.property_name).filter(Boolean)).size;
    const kpiReviews = tasks.map(t => t.review).filter(Boolean);
    const kpiReviewsWithScore = kpiReviews.filter(r => r?.cleanliness != null);
    const kpiCleanliness = kpiReviewsWithScore.length > 0
      ? kpiReviewsWithScore.reduce((s, r) => s + (r?.cleanliness ?? 0), 0) / kpiReviewsWithScore.length
      : null;

    return (
      <div style={{ minHeight: "100vh", background: "#f4f6f9", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#1a202c" }}>
        {nav}
        <div style={{ maxWidth: 1500, margin: "0 auto", padding: "24px 28px" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1a202c" }}>{c.vendor_name}</h1>
            <span style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 5, padding: "3px 10px", fontSize: 12, color: "#6b7280" }}>{dateLabel}</span>
          </div>
          <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "#9ca3af" }}>Individual clean history with on-time performance, cleanliness ratings, and refund exposure.</p>

          {/* KPI chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            <Chip label="Cleans" value={kpiCleans} />
            <Chip label="On-time Rate" value={pct(kpiOnTimeRate)} color={rateColor(kpiOnTimeRate)} />
            <Chip label="On-time / Cleans" value={`${kpiOnTime} / ${kpiDecided}`} />
            <Chip label="Tasks Overdue" value={kpiOverdue > 0 ? kpiOverdue : "None"} color={kpiOverdue > 0 ? "#dc2626" : "#16a34a"} />
            <Chip label="Properties" value={kpiProperties} />
            <Chip label="Cleanliness" value={fmtScore(kpiCleanliness)} color={scoreColor(kpiCleanliness)} />
            <Chip label="Reviews" value={kpiReviews.length || "None"} />
            <Chip label="Refund Exposure" value={fmtMoney(totalRefundAmt)} color={totalRefundAmt > 0 ? "#dc2626" : "#16a34a"} />
          </div>

          {/* Task table */}
          <div style={{ background: "#ffffff", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9", fontSize: 12, color: "#9ca3af" }}>
              {tasks.length} cleans &nbsp;·&nbsp; On-time rate applies to cleaning tasks only
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#1e2a3a" }}>
                    {["Sched Date", "Property", "Crew", "Status", "Finished (Time)", "On Time?", "Check-In Deadline", "Time", "Cleanliness", "Review", "Refund?"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t, i) => {
                    const finishedStr = t.finished_cst
                      ? `${fmtDateShort(t.finished_cst.dateStr)} ${t.finished_cst.hour}:${String(t.finished_cst.minute).padStart(2, "0")} ${t.tz_abbr || "CT"}`
                      : null;
                    const statusColor = !t.decided ? "#9ca3af" : t.is_finished ? "#16a34a" : "#dc2626";
                    const statusLabel = !t.decided ? "Scheduled" : t.is_finished ? "Completed" : "Overdue";
                    const deadlineLabel = t.deadline
                      ? <span style={{ color: t.deadline_type === "same-day" ? "#d97706" : "#3b82f6" }}>
                          {t.deadline_type === "same-day" ? "Same-day" : `Next: ${t.deadline}`}
                        </span>
                      : <span style={{ color: "#d1d5db" }}>—</span>;
                    const reviewText = (t.review as { review_text?: string } | null)?.review_text || null;
                    const refundAmt = t.linked_refunds.reduce((s, r) => s + r.refund_amount, 0);

                    return (
                      <tr key={t.task_id || i}
                        style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#ffffff" : "#fafbfc" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#eef2ff")}
                        onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "#ffffff" : "#fafbfc")}>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "#6b7280", fontWeight: 500 }}>{fmtDateShort(t.scheduled_date)}</td>
                        <td style={{ padding: "9px 12px", color: "#1e2a3a", fontWeight: 500, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span title={t.property_name || undefined}>{t.property_name || "—"}</span>
                        </td>
                        <td style={{ padding: "9px 12px", color: "#6b7280", whiteSpace: "nowrap" }}>{t.individual_name || "—"}</td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: statusColor, fontWeight: 600 }}>{statusLabel}</td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "#6b7280" }}>{finishedStr || "—"}</td>
                        <td style={{ padding: "9px 12px", textAlign: "center" }}>
                          {!t.decided ? <span style={{ color: "#d1d5db" }}>—</span>
                            : t.on_time ? <span style={{ color: "#16a34a", fontSize: 15, fontWeight: 700 }}>✓</span>
                            : <span style={{ color: "#dc2626", fontSize: 15, fontWeight: 700 }}>✗</span>}
                        </td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>{deadlineLabel}</td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: "#6b7280" }}>{fmtTime(parseTimeStr(t.total_time))}</td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: scoreColor(t.review?.cleanliness ?? null), fontWeight: t.review?.cleanliness != null ? 700 : 400 }}>
                          {t.review?.cleanliness != null ? t.review.cleanliness.toFixed(1) : "—"}
                        </td>
                        <td style={{ padding: "9px 12px", color: "#6b7280", maxWidth: 320, minWidth: 160 }}>
                          {reviewText
                            ? <span style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: "1.4", fontSize: 13 }}>{reviewText}</span>
                            : <span style={{ color: "#d1d5db" }}>—</span>}
                        </td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: refundAmt > 0 ? "#dc2626" : "#d1d5db", fontWeight: refundAmt > 0 ? 700 : 400 }}>
                          {refundAmt > 0 ? `$${refundAmt}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {tasks.length === 0 && (
                    <tr><td colSpan={11} style={{ padding: "32px", textAlign: "center", color: "#9ca3af" }}>No tasks in this range.</td></tr>
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
    <div style={{ minHeight: "100vh", background: "#f4f6f9", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#1a202c" }}>
      {nav}
      <div style={{ maxWidth: 1500, margin: "0 auto", padding: "24px 28px" }}>

        {/* Page heading */}
        <h1 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 700, color: "#1a202c" }}>Cleaner Scorecard</h1>
        <p style={{ margin: "0 0 18px 0", fontSize: 13, color: "#6b7280" }}>
          Every cleaner scored by on-time rate, cleanliness rating, and refund exposure.
          {meta && !loading && (
            <> &nbsp;·&nbsp; {meta.fromDate} → {meta.toDate} &nbsp;·&nbsp; {meta.taskCount.toLocaleString()} tasks &nbsp;·&nbsp; {meta.reviewCount} reviews
            {lastSyncedStr && <> &nbsp;·&nbsp; Last synced {lastSyncedStr}</>}</>
          )}
        </p>

        {/* KPI chips row */}
        {!loading && kpiRows.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
            {[
              { label: "Cleaners", value: kpiRows.length, render: (v: number) => String(v) },
              { label: "Total Cleans", value: kpiRows.reduce((s, r) => s + r.total_cleans, 0), render: (v: number) => v.toLocaleString() },
              { label: "Avg On-time", value: kpiOnTime, render: (v: number | null) => pct(v), color: rateColor(kpiOnTime) },
              { label: "Avg Cleanliness", value: kpiCleanliness, render: (v: number | null) => v == null ? "—" : v.toFixed(2), color: scoreColor(kpiCleanliness) },
              { label: "Reviews", value: kpiRows.reduce((s, r) => s + r.review_count, 0), render: (v: number) => v.toLocaleString() },
              { label: "Properties", value: kpiRows.reduce((s, r) => s + r.property_count, 0), render: (v: number) => v.toLocaleString() },
            ].map(({ label, value, render, color }) => (
              <div key={label} style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500 }}>{label}</span>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <span style={{ fontSize: 15, fontWeight: 700, color: color || "#1a202c" }}>{(render as (v: any) => string)(value)}</span>
              </div>
            ))}
          </div>
        )}

        {error && <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", fontSize: 13 }}>{error}</div>}

        <div style={{ background: "#ffffff", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          {loading && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0", color: "#9ca3af", fontSize: 14 }}>Loading…</div>}

          {!loading && rows.length === 0 && !error && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 0", gap: 8 }}>
              <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>No cleaner data for this range.</p>
              <p style={{ color: "#9ca3af", fontSize: 12, margin: 0 }}>Run the breezeway-tasks cron to populate data.</p>
            </div>
          )}

          {!loading && rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#1e2a3a" }}>
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
                  {visibleRows.map((row, i) => (
                    <tr key={row.vendor_name}
                      onClick={() => { setDrillCleaner(row); setFilterCleaner(row.vendor_name); }}
                      style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: i % 2 === 0 ? "#ffffff" : "#fafbfc" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#eef2ff")}
                      onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "#ffffff" : "#fafbfc")}>
                      <td style={{ padding: "11px 14px" }}>
                        <div style={{ fontWeight: 600, color: "#1e2a3a" }}>{row.vendor_name}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>{row.property_count} {row.property_count === 1 ? "property" : "properties"}</div>
                      </td>
                      <td style={{ padding: "11px 14px", textAlign: "right", color: "#374151", fontVariantNumeric: "tabular-nums" }}>{row.total_cleans}</td>
                      <td style={{ padding: "11px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: rateColor(row.on_time_rate), fontWeight: 700 }}>
                        {pct(row.on_time_rate)}
                        <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: 11, marginLeft: 4 }}>{row.on_time}/{row.decided}</span>
                      </td>
                      <td style={{ padding: "11px 14px", textAlign: "right", color: scoreColor(row.cleanliness_score), fontWeight: row.cleanliness_score != null ? 700 : 400 }}>{fmtScore(row.cleanliness_score)}</td>
                      <td style={{ padding: "11px 14px", textAlign: "right", color: "#6b7280" }}>{row.review_count || "—"}</td>
                      <td style={{ padding: "11px 14px", textAlign: "right", color: "#6b7280" }}>{fmtTime(row.median_time)}</td>
                      <td style={{ padding: "11px 14px", textAlign: "right", color: row.tasks_overdue > 0 ? "#dc2626" : "#9ca3af", fontWeight: row.tasks_overdue > 0 ? 700 : 400 }}>{row.tasks_overdue || "—"}</td>
                      <td style={{ padding: "11px 14px", textAlign: "right", color: row.refund_count > 0 ? "#dc2626" : "#9ca3af", fontWeight: row.refund_count > 0 ? 700 : 400 }}>{row.refund_count || "—"}</td>
                      <td style={{ padding: "11px 14px", textAlign: "right", color: row.refund_amount > 0 ? "#dc2626" : "#9ca3af", fontWeight: row.refund_amount > 0 ? 700 : 400 }}>{fmtMoney(row.refund_amount)}</td>
                      <td style={{ padding: "11px 14px", textAlign: "right", color: "#6b7280" }}>{row.property_count}</td>
                      <td style={{ padding: "11px 14px", textAlign: "center" }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: rateColor(row.on_time_rate), display: "inline-block" }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && rows.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af", textAlign: "right" }}>
            {visibleRows.length} cleaners &nbsp;·&nbsp; Click a row to drill down
          </div>
        )}
      </div>

      {/* ─── Settings Drawer ─────────────────────────────────────────────────── */}
      {showSettings && (
        <>
          {/* Backdrop */}
          <div onClick={() => { setShowSettings(false); setUserForm(null); setEditingUserId(null); }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100 }} />

          {/* Drawer panel */}
          <div style={{
            position: "fixed", top: 0, right: 0, bottom: 0, width: 560, background: "#ffffff",
            zIndex: 101, display: "flex", flexDirection: "column", boxShadow: "-8px 0 32px rgba(0,0,0,0.18)",
          }}>
            {/* Header */}
            <div style={{ padding: "20px 28px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>Settings</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Admin only</div>
              </div>
              <button onClick={() => { setShowSettings(false); setUserForm(null); setEditingUserId(null); }}
                style={{ border: "none", background: "none", fontSize: 22, color: "#9ca3af", cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
            </div>

            {/* Section title */}
            <div style={{ padding: "20px 28px 0" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Users &amp; Permissions</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                Manage who has access. Assign markets per user. Vendors can only see their assigned market.
              </div>
            </div>

            {/* User list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 28px" }}>
              {settingsLoading ? (
                <div style={{ color: "#9ca3af", fontSize: 13, padding: "20px 0" }}>Loading…</div>
              ) : (
                <>
                  {opsUsers.map(u => (
                    <div key={u.id} style={{
                      display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
                      border: "1px solid #e5e7eb", borderRadius: 10, marginBottom: 10, background: "#f9fafb",
                    }}>
                      {/* Avatar */}
                      <div style={{
                        width: 40, height: 40, borderRadius: "50%", background: "#1e293b",
                        color: "#fff", fontWeight: 700, fontSize: 14,
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}>
                        {u.name.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase()}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>{u.name}</div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 1 }}>{u.email}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                          {(u.markets || []).map((m: string) => (
                            <span key={m} style={{
                              fontSize: 11, fontWeight: 500, padding: "2px 8px",
                              background: "#e0f2fe", color: "#0369a1", borderRadius: 99,
                            }}>{MARKET_LABELS[m] || m}</span>
                          ))}
                          {(!u.markets || u.markets.length === 0) && (
                            <span style={{ fontSize: 11, color: "#9ca3af" }}>No markets assigned</span>
                          )}
                        </div>
                      </div>

                      {/* Role badge */}
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
                        background: ROLE_COLORS[u.role] + "22", color: ROLE_COLORS[u.role],
                        textTransform: "capitalize", flexShrink: 0,
                      }}>{u.role}</span>

                      {/* Actions */}
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => { setEditingUserId(u.id); setUserForm({ name: u.name, email: u.email, role: u.role, markets: u.markets || [], password: "" }); }}
                          style={{ fontSize: 12, padding: "4px 12px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer", color: "#374151" }}>Edit</button>
                        <button onClick={() => deleteUser(u.id)}
                          style={{ fontSize: 12, padding: "4px 12px", border: "1px solid #fca5a5", borderRadius: 6, background: "#fff", cursor: "pointer", color: "#dc2626" }}>Remove</button>
                      </div>
                    </div>
                  ))}

                  {/* Add user button */}
                  {!userForm && (
                    <button onClick={() => { setEditingUserId(null); setUserForm({ name: "", email: "", role: "employee", markets: [], password: "" }); }}
                      style={{
                        marginTop: 4, width: "100%", padding: "10px", border: "1px dashed #d1d5db",
                        borderRadius: 10, background: "transparent", color: "#6b7280", fontSize: 13,
                        cursor: "pointer", fontWeight: 500,
                      }}>+ Add User</button>
                  )}
                </>
              )}

              {/* Add / Edit form */}
              {userForm && (
                <div style={{ border: "1px solid #c7d2fe", borderRadius: 10, padding: 20, marginTop: 10, background: "#f8f7ff" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", marginBottom: 14 }}>
                    {editingUserId ? "Edit User" : "Add User"}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>Name</label>
                      <input value={userForm.name} onChange={e => setUserForm(f => f && ({ ...f, name: e.target.value }))}
                        placeholder="Full name" style={{ width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>Email</label>
                      <input value={userForm.email} onChange={e => setUserForm(f => f && ({ ...f, email: e.target.value }))}
                        placeholder="email@example.com" style={{ width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>Role</label>
                      <select value={userForm.role} onChange={e => setUserForm(f => f && ({ ...f, role: e.target.value }))}
                        style={{ width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, background: "#fff" }}>
                        <option value="admin">Admin</option>
                        <option value="employee">Employee</option>
                        <option value="vendor">Vendor</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>
                        {editingUserId ? "New Password" : "Password"}
                      </label>
                      <input
                        type="password"
                        value={userForm.password}
                        onChange={e => setUserForm(f => f && ({ ...f, password: e.target.value }))}
                        placeholder={editingUserId ? "Leave blank to keep current" : "Set password"}
                        style={{ width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>Markets</label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 4 }}>
                        {(["branson", "deep_creek", "poconos"] as const).map(mk => (
                          <label key={mk} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                            <input type="checkbox" checked={userForm.markets.includes(mk)}
                              onChange={e => setUserForm(f => {
                                if (!f) return f;
                                const ms = e.target.checked ? [...f.markets, mk] : f.markets.filter(m => m !== mk);
                                return { ...f, markets: ms };
                              })} />
                            {MARKET_LABELS[mk]}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                    <button onClick={saveUser}
                      style={{ padding: "7px 20px", background: "#1e293b", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      {editingUserId ? "Save Changes" : "Add User"}
                    </button>
                    <button onClick={() => { setUserForm(null); setEditingUserId(null); }}
                      style={{ padding: "7px 14px", background: "transparent", color: "#6b7280", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
