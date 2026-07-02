"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";

type Market = { id: string; display_name: string; city: string; state: string };
type Submission = {
  id: string;
  property_name: string | null;
  address: string | null;
  submitted_at: string;
  data: Record<string, unknown>;
};
type Generated = {
  airbnb_title: string;
  airbnb_description: string;
  vrbo_title: string;
  vrbo_description: string;
};

const EXCLUDE_KEYS = new Set(["IP Address", "Added Time", "Entry Id", "Submit Date", "Submit Time"]);

function OTAWriterContent() {
  const router = useRouter();

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
    function h(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showUserMenu]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedSub, setSelectedSub] = useState<Submission | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/onboarding/markets")
      .then(r => r.json())
      .then(j => {
        const ms = j.markets || [];
        setMarkets(ms);
        if (ms.length) setSelectedMarket(ms[0].id);
      });
  }, []);

  const loadSubs = useCallback((market: string, q: string) => {
    setSubLoading(true);
    setSelectedSub(null);
    setGenerated(null);
    const params = new URLSearchParams({ market, limit: "200", ...(q ? { search: q } : {}) });
    fetch(`/api/onboarding/submissions?${params}`)
      .then(r => r.json())
      .then(j => setSubmissions(j.submissions || []))
      .catch(() => {})
      .finally(() => setSubLoading(false));
  }, []);

  useEffect(() => {
    if (selectedMarket) loadSubs(selectedMarket, search);
  }, [selectedMarket]);

  function handleSearch(q: string) {
    setSearch(q);
    if (selectedMarket) loadSubs(selectedMarket, q);
  }

  async function generate() {
    if (!selectedSub) return;
    setGenerating(true);
    setGenError(null);
    setGenerated(null);
    try {
      const r = await fetch("/api/onboarding/ota-writer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selectedSub.id }),
      });
      const j = await r.json();
      if (!r.ok) { setGenError(j.error || "Generation failed"); return; }
      setGenerated(j);
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : "Network error");
    } finally {
      setGenerating(false);
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const navLink = (href: string, label: string, active: boolean) => (
    <a href={href} style={{
      fontSize: 13, fontWeight: 500, textDecoration: "none", padding: "0 14px",
      height: 52, display: "flex", alignItems: "center",
      color: active ? "#ffffff" : "#94a3b8",
      borderBottom: `2px solid ${active ? "#ffffff" : "transparent"}`,
    }}>{label}</a>
  );

  const visibleFields = selectedSub
    ? Object.entries(selectedSub.data || {}).filter(([k, v]) => !EXCLUDE_KEYS.has(k) && v !== null && v !== "")
    : [];

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6f9", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#1a202c" }}>

      {/* Nav */}
      <nav style={{ background: "#1e293b", borderBottom: "1px solid #334155", padding: "0 24px", display: "flex", alignItems: "center", height: 52 }}>
        <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", marginRight: 28 }}>
          <span style={{ color: "#ffffff" }}>Vistas</span> Ops
        </span>
        {navLink("/onboarding", "Onboarding", true)}
        {navLink("/", "Cleaning", false)}
        {(currentUser?.role === "admin" || currentUser?.role === "employee") && navLink("/maintenance", "Maintenance", false)}
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
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 200, background: "#ffffff", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.15)", border: "1px solid #e5e7eb", zIndex: 200, overflow: "hidden" }}>
              {currentUser && (
                <div style={{ padding: "12px 14px", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{currentUser.name}</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{currentUser.email}</div>
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
        <a href="/onboarding" style={{ fontSize: 12, color: "#64748b", textDecoration: "none" }}>← Back to Onboarding</a>
      </div>

      {/* Body */}
      <div style={{ display: "flex", height: "calc(100vh - 96px)", overflow: "hidden" }}>

        {/* Left: property list */}
        <div style={{ width: 300, flexShrink: 0, background: "#ffffff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #f3f4f6" }}>
            <input
              type="search"
              placeholder="Search properties…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {subLoading ? (
              <div style={{ padding: 20, fontSize: 13, color: "#9ca3af", textAlign: "center" }}>Loading…</div>
            ) : submissions.length === 0 ? (
              <div style={{ padding: 20, fontSize: 13, color: "#9ca3af", textAlign: "center" }}>
                {search ? "No matches" : "No submissions synced yet"}
              </div>
            ) : submissions.map(s => (
              <button
                key={s.id}
                onClick={() => { setSelectedSub(s); setGenerated(null); setGenError(null); }}
                style={{
                  width: "100%", textAlign: "left", padding: "11px 14px",
                  border: "none", borderBottom: "1px solid #f3f4f6",
                  background: selectedSub?.id === s.id ? "#f0f9ff" : "none",
                  cursor: "pointer",
                  borderLeft: `3px solid ${selectedSub?.id === s.id ? "#0ea5e9" : "transparent"}`,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.property_name || "Unnamed"}
                </div>
                {s.address && (
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.address}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Right: detail + generation */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {!selectedSub ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, color: "#9ca3af" }}>
              <div style={{ fontSize: 40 }}>✍️</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Select a property</div>
              <div style={{ fontSize: 13 }}>Choose a property from the list to generate listing copy.</div>
            </div>
          ) : (
            <div style={{ maxWidth: 720 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16 }}>
                <div>
                  <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{selectedSub.property_name || "Unnamed Property"}</h1>
                  {selectedSub.address && <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>{selectedSub.address}</p>}
                </div>
                <button
                  onClick={generate}
                  disabled={generating}
                  style={{
                    padding: "10px 20px", borderRadius: 8, border: "none",
                    background: generating ? "#d1d5db" : "#1e293b",
                    color: "#ffffff", fontSize: 14, fontWeight: 600,
                    cursor: generating ? "wait" : "pointer", whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >
                  {generating ? "Generating…" : "✦ Generate Listings"}
                </button>
              </div>

              {genError && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#dc2626" }}>
                  {genError}
                </div>
              )}

              {generated && (
                <div style={{ marginBottom: 28 }}>
                  <h2 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, color: "#1a202c" }}>Generated Copy</h2>
                  {[
                    { platform: "Airbnb", titleKey: "airbnb_title", descKey: "airbnb_description", maxTitle: 50 },
                    { platform: "VRBO", titleKey: "vrbo_title", descKey: "vrbo_description", maxTitle: 80 },
                  ].map(({ platform, titleKey, descKey, maxTitle }) => (
                    <div key={platform} style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#1a202c" }}>{platform}</span>
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af" }}>Title</span>
                          <span style={{ fontSize: 11, color: (generated[titleKey as keyof Generated] || "").length > maxTitle ? "#dc2626" : "#9ca3af" }}>
                            {(generated[titleKey as keyof Generated] || "").length}/{maxTitle}
                          </span>
                          <button onClick={() => copy(generated[titleKey as keyof Generated] || "", `${platform}-title`)} style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 4, border: "1px solid #e2e8f0", background: "none", fontSize: 11, cursor: "pointer", color: "#6b7280" }}>
                            {copied === `${platform}-title` ? "✓ Copied" : "Copy"}
                          </button>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", lineHeight: 1.4 }}>{generated[titleKey as keyof Generated]}</div>
                      </div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af" }}>Description</span>
                          <button onClick={() => copy(generated[descKey as keyof Generated] || "", `${platform}-desc`)} style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 4, border: "1px solid #e2e8f0", background: "none", fontSize: 11, cursor: "pointer", color: "#6b7280" }}>
                            {copied === `${platform}-desc` ? "✓ Copied" : "Copy"}
                          </button>
                        </div>
                        <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{generated[descKey as keyof Generated]}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Property data */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px" }}>
                <h2 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700, color: "#374151" }}>Inspection Data ({visibleFields.length} fields)</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "10px 24px" }}>
                  {visibleFields.map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af", marginBottom: 2 }}>{k}</div>
                      <div style={{ fontSize: 13, color: "#374151", wordBreak: "break-word" }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OTAWriterPage() {
  return (
    <Suspense>
      <OTAWriterContent />
    </Suspense>
  );
}
