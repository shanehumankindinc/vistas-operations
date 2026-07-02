"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";

type Market = { id: string; display_name: string };
type BzProperty = {
  bz_id: string;
  bz_name: string;
  bz_address: string | null;
  bz_notes: string | null;
  bz_tags: string[];
  zoho_submission: { id: string; property_name: string; address: string | null; submitted_at: string } | null;
};

const SKIP_ZOHO_KEYS = new Set(["IP Address", "Added Time", "Entry Id", "Submit Date", "Submit Time", "Property name:", "Property Name", "Address:", "Address"]);

function BreezewaySyncContent() {
  const router = useRouter();
  const currentUser = useMemo(() => {
    if (typeof document === "undefined") return null;
    const m = document.cookie.match(/(?:^|;\s*)ops_ui=([^;]+)/);
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
  }, []);

  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showUserMenu) return;
    function h(e: MouseEvent) { if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showUserMenu]);

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }

  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [properties, setProperties] = useState<BzProperty[]>([]);
  const [meta, setMeta] = useState<{ total: number; matched: number; zoho_count: number; bz_error: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "matched" | "unmatched">("all");
  const [selected, setSelected] = useState<BzProperty | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/onboarding/markets").then(r => r.json()).then(j => {
      const ms = j.markets || [];
      setMarkets(ms);
      if (ms.length) setSelectedMarket(ms[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedMarket) return;
    setLoading(true);
    setProperties([]);
    setSelected(null);
    setMeta(null);
    fetch(`/api/onboarding/breezeway-sync?market=${selectedMarket}`)
      .then(r => r.json())
      .then(j => {
        setProperties(j.properties || []);
        setMeta({ total: j.total, matched: j.matched, zoho_count: j.zoho_count, bz_error: j.bz_error });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedMarket]);

  function selectProp(p: BzProperty) { setSelected(p); setNotes(p.bz_notes || ""); setSaveMsg(null); }

  async function saveNotes() {
    if (!selected || !selectedMarket) return;
    setSaving(true); setSaveMsg(null);
    const r = await fetch("/api/onboarding/breezeway-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market: selectedMarket, bz_id: selected.bz_id, notes }),
    });
    const j = await r.json();
    setSaving(false);
    if (r.ok) {
      setSaveMsg({ ok: true, text: "Notes saved to Breezeway." });
      setProperties(prev => prev.map(p => p.bz_id === selected.bz_id ? { ...p, bz_notes: notes } : p));
      setSelected(s => s ? { ...s, bz_notes: notes } : s);
    } else {
      setSaveMsg({ ok: false, text: j.error || "Save failed" });
    }
  }

  const navLink = (href: string, label: string, active: boolean) => (
    <a href={href} style={{ fontSize: 13, fontWeight: 500, textDecoration: "none", padding: "0 14px", height: 52, display: "flex", alignItems: "center", color: active ? "#ffffff" : "#94a3b8", borderBottom: `2px solid ${active ? "#ffffff" : "transparent"}` }}>{label}</a>
  );

  const filtered = properties
    .filter(p => !search || p.bz_name.toLowerCase().includes(search.toLowerCase()))
    .filter(p => filter === "all" ? true : filter === "matched" ? !!p.zoho_submission : !p.zoho_submission);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6f9", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#1a202c" }}>
      <nav style={{ background: "#1e293b", borderBottom: "1px solid #334155", padding: "0 24px", display: "flex", alignItems: "center", height: 52 }}>
        <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", marginRight: 28 }}><span style={{ color: "#ffffff" }}>Vistas</span> Ops</span>
        {navLink("/onboarding", "Onboarding", true)}
        {navLink("/", "Cleaning", false)}
        {(currentUser?.role === "admin" || currentUser?.role === "employee") && navLink("/maintenance", "Maintenance", false)}
        <div style={{ flex: 1 }} />
        <div ref={userMenuRef} style={{ position: "relative" }}>
          <button onClick={() => setShowUserMenu(v => !v)} style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: currentUser ? "#4f7c6b" : "#334155", color: "#ffffff", fontWeight: 700, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {currentUser ? currentUser.name.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase() : "?"}
          </button>
          {showUserMenu && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 200, background: "#ffffff", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.15)", border: "1px solid #e5e7eb", zIndex: 200, overflow: "hidden" }}>
              {currentUser && <div style={{ padding: "12px 14px", borderBottom: "1px solid #f3f4f6" }}><div style={{ fontSize: 13, fontWeight: 600 }}>{currentUser.name}</div></div>}
              <button onClick={logout} style={{ width: "100%", padding: "10px 14px", border: "none", background: "none", textAlign: "left", fontSize: 13, color: "#dc2626", cursor: "pointer", fontWeight: 500 }}>Sign out</button>
            </div>
          )}
        </div>
      </nav>

      <div style={{ background: "#ffffff", borderBottom: "1px solid #e2e8f0", padding: "0 24px", display: "flex", alignItems: "center", height: 44, gap: 12 }}>
        {markets.map(m => (
          <button key={m.id} onClick={() => setSelectedMarket(m.id)} style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid", borderColor: selectedMarket === m.id ? "#1e293b" : "#e2e8f0", background: selectedMarket === m.id ? "#1e293b" : "transparent", color: selectedMarket === m.id ? "#ffffff" : "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{m.display_name}</button>
        ))}
        <div style={{ flex: 1 }} />
        <a href="/onboarding" style={{ fontSize: 12, color: "#64748b", textDecoration: "none" }}>← Back to Onboarding</a>
      </div>

      <div style={{ display: "flex", height: "calc(100vh - 96px)", overflow: "hidden" }}>
        {/* Left panel */}
        <div style={{ width: 320, flexShrink: 0, background: "#ffffff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #f3f4f6", display: "flex", flexDirection: "column", gap: 8 }}>
            <input type="search" placeholder="Search properties…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 6 }}>
              {(["all", "matched", "unmatched"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{ flex: 1, padding: "4px 0", borderRadius: 5, border: "1px solid", borderColor: filter === f ? "#1e293b" : "#e2e8f0", background: filter === f ? "#1e293b" : "transparent", color: filter === f ? "#fff" : "#64748b", fontSize: 11, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>{f}</button>
              ))}
            </div>
          </div>
          {meta && (
            <div style={{ padding: "8px 14px", borderBottom: "1px solid #f3f4f6", display: "flex", gap: 12 }}>
              <span style={{ fontSize: 11, color: "#6b7280" }}><b style={{ color: "#16a34a" }}>{meta.matched}</b>/{meta.total} matched</span>
              <span style={{ fontSize: 11, color: "#6b7280" }}><b>{meta.zoho_count}</b> Zoho records</span>
            </div>
          )}
          {meta?.bz_error && (
            <div style={{ padding: "8px 14px", background: "#fef2f2", fontSize: 11, color: "#dc2626" }}>{meta.bz_error}</div>
          )}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading ? (
              <div style={{ padding: 20, fontSize: 13, color: "#9ca3af", textAlign: "center" }}>Loading Breezeway…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 20, fontSize: 13, color: "#9ca3af", textAlign: "center" }}>No properties found</div>
            ) : filtered.map(p => (
              <button key={p.bz_id} onClick={() => selectProp(p)} style={{
                width: "100%", textAlign: "left", padding: "10px 14px", border: "none",
                borderBottom: "1px solid #f3f4f6",
                background: selected?.bz_id === p.bz_id ? "#f0f9ff" : "none",
                borderLeft: `3px solid ${selected?.bz_id === p.bz_id ? "#0ea5e9" : "transparent"}`,
                cursor: "pointer",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: p.zoho_submission ? "#16a34a" : "#d1d5db", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.bz_name}</span>
                </div>
                {p.bz_address && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2, marginLeft: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.bz_address}</div>}
              </button>
            ))}
          </div>
        </div>

        {/* Right panel */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {!selected ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, color: "#9ca3af" }}>
              <div style={{ fontSize: 40 }}>🔄</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Select a property</div>
              <div style={{ fontSize: 13 }}>Choose a Breezeway property to view its Zoho match and edit notes.</div>
            </div>
          ) : (
            <div style={{ maxWidth: 680 }}>
              <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700 }}>{selected.bz_name}</h1>
              {selected.bz_address && <p style={{ margin: "0 0 20px", fontSize: 13, color: "#6b7280" }}>{selected.bz_address}</p>}

              {/* Match status */}
              <div style={{ background: selected.zoho_submission ? "#f0fdf4" : "#fff7ed", border: `1px solid ${selected.zoho_submission ? "#bbf7d0" : "#fed7aa"}`, borderRadius: 8, padding: "12px 16px", marginBottom: 20 }}>
                {selected.zoho_submission ? (
                  <div style={{ fontSize: 13, color: "#15803d" }}>
                    ✓ Matched Zoho submission: <b>{selected.zoho_submission.property_name}</b>
                    <span style={{ color: "#9ca3af", marginLeft: 8 }}>({new Date(selected.zoho_submission.submitted_at).toLocaleDateString()})</span>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "#c2410c" }}>⚠ No matching Zoho submission found for this property.</div>
                )}
              </div>

              {/* Current tags */}
              {selected.bz_tags.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Breezeway Tags</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {selected.bz_tags.map((t, i) => (
                      <span key={i} style={{ padding: "3px 10px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 20, fontSize: 12, color: "#334155" }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes editor */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Property Notes (visible to cleaners in Breezeway)
                </div>
                <textarea
                  value={notes}
                  onChange={e => { setNotes(e.target.value); setSaveMsg(null); }}
                  rows={8}
                  placeholder="Enter property notes (access codes, parking, special instructions, etc.)…"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13, lineHeight: 1.6, resize: "vertical", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                  <button
                    onClick={saveNotes}
                    disabled={saving}
                    style={{ padding: "9px 20px", borderRadius: 7, border: "none", background: saving ? "#d1d5db" : "#1e293b", color: "#fff", fontSize: 13, fontWeight: 600, cursor: saving ? "wait" : "pointer" }}
                  >
                    {saving ? "Saving…" : "Push Notes to Breezeway"}
                  </button>
                  {saveMsg && (
                    <span style={{ fontSize: 13, color: saveMsg.ok ? "#16a34a" : "#dc2626" }}>{saveMsg.text}</span>
                  )}
                </div>
              </div>

              {/* Zoho data reference */}
              {selected.zoho_submission && (
                <ZohoDataPanel submissionId={selected.zoho_submission.id} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ZohoDataPanel({ submissionId }: { submissionId: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/onboarding/submissions?market=all&id=${submissionId}`)
      .then(r => r.json())
      .then(j => {
        const sub = j.submissions?.[0];
        if (sub) setData(sub.data);
      })
      .catch(() => {});
  }, [submissionId]);

  const fields = data ? Object.entries(data).filter(([k, v]) => !SKIP_ZOHO_KEYS.has(k) && v !== null && v !== "") : [];

  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
      <button onClick={() => setOpen(v => !v)} style={{ width: "100%", padding: "12px 16px", border: "none", background: "none", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Zoho Submission Data ({fields.length} fields)</span>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>{open ? "▲ Hide" : "▼ Show"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "8px 20px" }}>
          {fields.map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af", marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 12, color: "#374151", wordBreak: "break-word" }}>{String(v)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BreezewaySyncPage() {
  return <Suspense><BreezewaySyncContent /></Suspense>;
}
