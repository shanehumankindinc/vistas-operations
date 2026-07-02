"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

type Market = { id: string; display_name: string; city: string; state: string };
type Submission = {
  id: string;
  market_id: string;
  property_name: string | null;
  address: string | null;
  submitted_at: string;
  sheet_row: number | null;
  data: Record<string, unknown>;
};

function SubmissionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentUser = useMemo(() => {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(/(?:^|;\s*)ops_ui=([^;]+)/);
    if (!match) return null;
    try { return JSON.parse(decodeURIComponent(match[1])); } catch { return null; }
  }, []);

  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showUserMenu) return;
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showUserMenu]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string | null>(searchParams.get("market"));

  useEffect(() => {
    fetch("/api/onboarding/markets")
      .then(r => r.json())
      .then(j => {
        const ms: Market[] = j.markets || [];
        setMarkets(ms);
        if (!selectedMarket && ms.length) setSelectedMarket(ms[0].id);
      })
      .catch(() => {});
  }, []);

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback((market: string, pg: number, q: string) => {
    setLoading(true);
    const params = new URLSearchParams({ market, page: String(pg), ...(q ? { search: q } : {}) });
    fetch(`/api/onboarding/submissions?${params}`)
      .then(r => r.json())
      .then(j => {
        setSubmissions(j.submissions || []);
        setTotalCount(j.count ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedMarket) return;
    setPage(1);
    setExpandedId(null);
    load(selectedMarket, 1, search);
  }, [selectedMarket]);

  useEffect(() => {
    if (!selectedMarket) return;
    load(selectedMarket, page, search);
  }, [page]);

  function handleSearch(q: string) {
    setSearch(q);
    setPage(1);
    if (selectedMarket) load(selectedMarket, 1, q);
  }

  const navLink = (href: string, label: string, active: boolean) => (
    <a href={href} style={{
      fontSize: 13, fontWeight: 500, textDecoration: "none", padding: "0 14px",
      height: 52, display: "flex", alignItems: "center",
      color: active ? "#ffffff" : "#94a3b8",
      borderBottom: `2px solid ${active ? "#ffffff" : "transparent"}`,
    }}>{label}</a>
  );

  const totalPages = Math.ceil(totalCount / 50);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6f9", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#1a202c" }}>

      {/* Nav */}
      <nav style={{ background: "#1e293b", borderBottom: "1px solid #334155", padding: "0 24px", display: "flex", alignItems: "center", height: 52 }}>
        <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", marginRight: 28 }}>
          <span style={{ color: "#ffffff" }}>Vistas</span> Ops
        </span>
        {navLink("/onboarding", "Onboarding", true)}
        {navLink("/", "Cleaning", false)}
        {(currentUser?.role === "admin" || currentUser?.role === "employee") &&
          navLink("/maintenance", "Maintenance", false)}
        <div style={{ flex: 1 }} />
        <div ref={userMenuRef} style={{ position: "relative" }}>
          <button onClick={() => setShowUserMenu(v => !v)} style={{
            width: 32, height: 32, borderRadius: "50%", border: "none",
            background: currentUser ? "#4f7c6b" : "#334155",
            color: "#ffffff", fontWeight: 700, fontSize: 12, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {currentUser ? currentUser.name.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase() : "?"}
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
              <button onClick={logout} style={{ width: "100%", padding: "10px 14px", border: "none", background: "none", textAlign: "left", fontSize: 13, color: "#dc2626", cursor: "pointer", fontWeight: 500 }}>Sign out</button>
            </div>
          )}
        </div>
      </nav>

      {/* Sub-toolbar */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e2e8f0", padding: "0 24px", display: "flex", alignItems: "center", height: 44, gap: 12 }}>
        {markets.map(m => (
          <button key={m.id} onClick={() => setSelectedMarket(m.id)} style={{
            padding: "5px 14px", borderRadius: 6, border: "1px solid",
            borderColor: selectedMarket === m.id ? "#1e293b" : "#e2e8f0",
            background: selectedMarket === m.id ? "#1e293b" : "transparent",
            color: selectedMarket === m.id ? "#ffffff" : "#64748b",
            fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
          }}>{m.display_name}</button>
        ))}
        <div style={{ flex: 1 }} />
        <a href="/onboarding" style={{ fontSize: 12, color: "#64748b", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
          ← Back to Onboarding
        </a>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Zoho Property Submissions</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
              {totalCount} submission{totalCount !== 1 ? "s" : ""} synced
            </p>
          </div>
          <input
            type="search"
            placeholder="Search by property name…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            style={{
              padding: "8px 12px", borderRadius: 7, border: "1px solid #d1d5db",
              fontSize: 13, width: 240, outline: "none", color: "#1a202c",
            }}
          />
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: 40, color: "#9ca3af", fontSize: 13 }}>Loading…</div>
        )}

        {!loading && submissions.length === 0 && (
          <div style={{
            background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10,
            padding: "40px 24px", textAlign: "center",
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
              {search ? "No matching submissions" : "No submissions yet"}
            </div>
            <div style={{ fontSize: 13, color: "#6b7280" }}>
              {search ? "Try a different search term." : "Set up the Apps Script trigger in Google Sheets to start syncing."}
            </div>
          </div>
        )}

        {!loading && submissions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {submissions.map(sub => (
              <SubmissionRow
                key={sub.id}
                sub={sub}
                expanded={expandedId === sub.id}
                onToggle={() => setExpandedId(expandedId === sub.id ? null : sub.id)}
              />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 24 }}>
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              style={{
                padding: "6px 16px", borderRadius: 6, border: "1px solid #d1d5db",
                background: page <= 1 ? "#f9fafb" : "#ffffff", color: page <= 1 ? "#9ca3af" : "#374151",
                fontSize: 13, cursor: page <= 1 ? "default" : "pointer",
              }}
            >← Prev</button>
            <span style={{ display: "flex", alignItems: "center", fontSize: 13, color: "#6b7280" }}>
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              style={{
                padding: "6px 16px", borderRadius: 6, border: "1px solid #d1d5db",
                background: page >= totalPages ? "#f9fafb" : "#ffffff", color: page >= totalPages ? "#9ca3af" : "#374151",
                fontSize: 13, cursor: page >= totalPages ? "default" : "pointer",
              }}
            >Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}

function SubmissionRow({ sub, expanded, onToggle }: { sub: Submission; expanded: boolean; onToggle: () => void }) {
  const date = new Date(sub.submitted_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const fields = Object.entries(sub.data || {}).filter(([, v]) => v !== null && v !== "" && v !== undefined);

  return (
    <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          padding: "14px 18px", border: "none", background: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          width: 28, height: 28, borderRadius: "50%", background: "#f0fdf4",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, flexShrink: 0,
        }}>🏠</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {sub.property_name || "Unnamed property"}
          </div>
          {sub.address && (
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {sub.address}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>{date}</span>
          {sub.sheet_row && (
            <span style={{ fontSize: 11, color: "#d1d5db" }}>row {sub.sheet_row}</span>
          )}
          <span style={{ fontSize: 12, color: "#6b7280", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: "1px solid #f3f4f6", padding: "16px 18px" }}>
          {fields.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>No data fields.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "8px 24px" }}>
              {fields.map(([key, val]) => (
                <div key={key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af" }}>
                    {key}
                  </span>
                  <span style={{ fontSize: 13, color: "#374151", wordBreak: "break-word" }}>
                    {typeof val === "object" ? JSON.stringify(val) : String(val)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SubmissionsPage() {
  return (
    <Suspense>
      <SubmissionsContent />
    </Suspense>
  );
}
