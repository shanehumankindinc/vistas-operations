"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";

type Market = { id: string; display_name: string };
type Submission = { id: string; property_name: string | null; address: string | null; submitted_at: string };
type BzMatch = { bz_id: string; bz_name: string; bz_tags: string[] } | null;

function TagDetectionContent() {
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
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Submission | null>(null);
  const [bzMatch, setBzMatch] = useState<BzMatch>(null);
  const [bzLoading, setBzLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState<string[] | null>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [approvedTags, setApprovedTags] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/onboarding/markets").then(r => r.json()).then(j => {
      const ms = j.markets || [];
      setMarkets(ms);
      if (ms.length) setSelectedMarket(ms[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedMarket) return;
    setSubsLoading(true);
    setSubmissions([]);
    setSelected(null);
    setSuggestedTags(null);
    fetch(`/api/onboarding/submissions?market=${selectedMarket}&limit=200`)
      .then(r => r.json())
      .then(j => setSubmissions(j.submissions || []))
      .catch(() => {})
      .finally(() => setSubsLoading(false));
  }, [selectedMarket]);

  async function selectSub(sub: Submission) {
    setSelected(sub);
    setSuggestedTags(null);
    setReasoning(null);
    setApprovedTags(new Set());
    setApplyMsg(null);
    setSuggestError(null);
    setBzMatch(null);

    // Try to find matching BZ property
    if (selectedMarket) {
      setBzLoading(true);
      try {
        const r = await fetch(`/api/onboarding/breezeway-sync?market=${selectedMarket}`);
        const j = await r.json();
        const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const subNorm = norm(sub.property_name || "");
        const match = (j.properties || []).find((p: { bz_name: string }) => norm(p.bz_name) === subNorm);
        setBzMatch(match || null);
      } catch { setBzMatch(null); }
      finally { setBzLoading(false); }
    }
  }

  async function suggest() {
    if (!selected) return;
    setSuggesting(true);
    setSuggestError(null);
    setSuggestedTags(null);
    setReasoning(null);
    setApprovedTags(new Set());
    try {
      const r = await fetch("/api/onboarding/tag-detection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest", submission_id: selected.id }),
      });
      const j = await r.json();
      if (!r.ok) { setSuggestError(j.error || "Suggestion failed"); return; }
      setSuggestedTags(j.tags || []);
      setReasoning(j.reasoning || null);
      setApprovedTags(new Set(j.tags || []));
    } catch (e: unknown) {
      setSuggestError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSuggesting(false);
    }
  }

  function toggleTag(tag: string) {
    setApprovedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }

  async function applyTags() {
    if (!bzMatch || !selectedMarket) return;
    setApplying(true);
    setApplyMsg(null);
    const r = await fetch("/api/onboarding/tag-detection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply", market: selectedMarket, bz_id: bzMatch.bz_id, tags: [...approvedTags] }),
    });
    const j = await r.json();
    setApplying(false);
    setApplyMsg(r.ok ? { ok: true, text: `Applied ${approvedTags.size} tags to Breezeway.` } : { ok: false, text: j.error || "Apply failed" });
  }

  const navLink = (href: string, label: string, active: boolean) => (
    <a href={href} style={{ fontSize: 13, fontWeight: 500, textDecoration: "none", padding: "0 14px", height: 52, display: "flex", alignItems: "center", color: active ? "#ffffff" : "#94a3b8", borderBottom: `2px solid ${active ? "#ffffff" : "transparent"}` }}>{label}</a>
  );

  const filtered = submissions.filter(s => !search || (s.property_name || "").toLowerCase().includes(search.toLowerCase()));

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
        {/* Left: submissions list */}
        <div style={{ width: 300, flexShrink: 0, background: "#ffffff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #f3f4f6" }}>
            <input type="search" placeholder="Search properties…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {subsLoading ? (
              <div style={{ padding: 20, fontSize: 13, color: "#9ca3af", textAlign: "center" }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 20, fontSize: 13, color: "#9ca3af", textAlign: "center" }}>No submissions yet</div>
            ) : filtered.map(s => (
              <button key={s.id} onClick={() => selectSub(s)} style={{
                width: "100%", textAlign: "left", padding: "10px 14px", border: "none",
                borderBottom: "1px solid #f3f4f6",
                background: selected?.id === s.id ? "#f0f9ff" : "none",
                borderLeft: `3px solid ${selected?.id === s.id ? "#0ea5e9" : "transparent"}`,
                cursor: "pointer",
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.property_name || "Unnamed"}</div>
                {s.address && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.address}</div>}
              </button>
            ))}
          </div>
        </div>

        {/* Right */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {!selected ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, color: "#9ca3af" }}>
              <div style={{ fontSize: 40 }}>🏷️</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Select a property</div>
              <div style={{ fontSize: 13 }}>AI will analyze the inspection data and suggest Breezeway tags.</div>
            </div>
          ) : (
            <div style={{ maxWidth: 680 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16 }}>
                <div>
                  <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{selected.property_name || "Unnamed"}</h1>
                  {selected.address && <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>{selected.address}</p>}
                </div>
                <button onClick={suggest} disabled={suggesting}
                  style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: suggesting ? "#d1d5db" : "#1e293b", color: "#fff", fontSize: 14, fontWeight: 600, cursor: suggesting ? "wait" : "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {suggesting ? "Analyzing…" : "✦ Detect Tags"}
                </button>
              </div>

              {/* BZ match */}
              <div style={{ marginBottom: 16 }}>
                {bzLoading ? (
                  <div style={{ fontSize: 13, color: "#9ca3af" }}>Looking up Breezeway property…</div>
                ) : bzMatch ? (
                  <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#15803d" }}>
                    ✓ Breezeway match: <b>{bzMatch.bz_name}</b>
                    {bzMatch.bz_tags.length > 0 && (
                      <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                        <span style={{ color: "#6b7280", marginRight: 4 }}>Current tags:</span>
                        {bzMatch.bz_tags.map((t, i) => <span key={i} style={{ padding: "2px 8px", background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: 20, fontSize: 11, color: "#15803d" }}>{t}</span>)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#c2410c" }}>
                    ⚠ No matching Breezeway property — tags cannot be applied automatically.
                  </div>
                )}
              </div>

              {suggestError && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>{suggestError}</div>
              )}

              {suggestedTags !== null && (
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Suggested Tags</div>
                  {reasoning && <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14, lineHeight: 1.5 }}>{reasoning}</div>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                    {suggestedTags.map(tag => (
                      <button key={tag} onClick={() => toggleTag(tag)} style={{
                        padding: "6px 14px", borderRadius: 20, border: "2px solid",
                        borderColor: approvedTags.has(tag) ? "#1e293b" : "#e2e8f0",
                        background: approvedTags.has(tag) ? "#1e293b" : "#f8fafc",
                        color: approvedTags.has(tag) ? "#ffffff" : "#374151",
                        fontSize: 13, fontWeight: 500, cursor: "pointer", transition: "all 0.1s",
                      }}>
                        {approvedTags.has(tag) ? "✓ " : ""}{tag}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button
                      onClick={applyTags}
                      disabled={applying || !bzMatch || approvedTags.size === 0}
                      style={{
                        padding: "9px 20px", borderRadius: 7, border: "none",
                        background: (!bzMatch || approvedTags.size === 0 || applying) ? "#d1d5db" : "#1e293b",
                        color: "#fff", fontSize: 13, fontWeight: 600,
                        cursor: (!bzMatch || approvedTags.size === 0 || applying) ? "default" : "pointer",
                      }}
                    >
                      {applying ? "Applying…" : `Apply ${approvedTags.size} Tag${approvedTags.size !== 1 ? "s" : ""} to Breezeway`}
                    </button>
                    {!bzMatch && <span style={{ fontSize: 12, color: "#9ca3af" }}>Requires a Breezeway match to apply.</span>}
                    {applyMsg && <span style={{ fontSize: 13, color: applyMsg.ok ? "#16a34a" : "#dc2626" }}>{applyMsg.text}</span>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TagDetectionPage() {
  return <Suspense><TagDetectionContent /></Suspense>;
}
