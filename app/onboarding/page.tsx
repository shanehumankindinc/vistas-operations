"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

type Market = {
  id: string;
  display_name: string;
  company_name: string | null;
  city: string;
  state: string;
};

export default function OnboardingPage() {
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
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [marketsLoading, setMarketsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/onboarding/markets")
      .then(r => r.json())
      .then(j => {
        setMarkets(j.markets || []);
        if (j.markets?.length) setSelectedMarket(j.markets[0].id);
      })
      .catch(() => {})
      .finally(() => setMarketsLoading(false));
  }, []);

  const activeMarket = markets.find(m => m.id === selectedMarket) || null;

  const navLink = (href: string, label: string, active: boolean) => (
    <a href={href} style={{
      fontSize: 13, fontWeight: 500, textDecoration: "none", padding: "0 14px",
      height: 52, display: "flex", alignItems: "center",
      color: active ? "#ffffff" : "#94a3b8",
      borderBottom: `2px solid ${active ? "#ffffff" : "transparent"}`,
    }}>{label}</a>
  );

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
        {marketsLoading ? (
          <span style={{ fontSize: 13, color: "#9ca3af" }}>Loading…</span>
        ) : (
          <>
            {markets.map(m => (
              <button key={m.id} onClick={() => setSelectedMarket(m.id)} style={{
                padding: "5px 14px", borderRadius: 6, border: "1px solid",
                borderColor: selectedMarket === m.id ? "#1e293b" : "#e2e8f0",
                background: selectedMarket === m.id ? "#1e293b" : "transparent",
                color: selectedMarket === m.id ? "#ffffff" : "#64748b",
                fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}>{m.display_name}</button>
            ))}
          </>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#94a3b8" }}>Property Onboarding</span>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 28px" }}>

        {activeMarket && (
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#1a202c" }}>
              {activeMarket.display_name}
            </h1>
            {(activeMarket.city || activeMarket.state) && (
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
                {[activeMarket.city, activeMarket.state].filter(Boolean).join(", ")}
              </p>
            )}
          </div>
        )}

        {/* Tool cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          <ToolCard
            icon="✍️"
            title="OTA Listing Writer"
            description="Generate Airbnb and VRBO listings from Zoho inspection data using AI."
            status="coming soon"
          />
          <ToolCard
            icon="🔄"
            title="Breezeway Sync"
            description="Push property tags, notes, and custom fields from Guesty to Breezeway."
            status="coming soon"
          />
          <ToolCard
            icon="🏷️"
            title="Tag Detection"
            description="Review and correct suggested Breezeway tags based on property data."
            status="coming soon"
          />
          <ToolCard
            icon="📋"
            title="Property Data"
            description="View and edit Zoho inspection submissions per property."
            status="coming soon"
          />
        </div>

        {/* Zoho submissions count */}
        <ZohoCount marketId={selectedMarket} />
      </div>
    </div>
  );
}

function ToolCard({ icon, title, description, status }: { icon: string; title: string; description: string; status: string }) {
  return (
    <div style={{
      background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10,
      padding: "20px 22px", display: "flex", flexDirection: "column", gap: 10,
      opacity: status === "coming soon" ? 0.75 : 1,
    }}>
      <div style={{ fontSize: 28 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1a202c", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>{description}</div>
      </div>
      <div style={{ marginTop: "auto", paddingTop: 8 }}>
        <span style={{
          fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
          color: status === "coming soon" ? "#9ca3af" : "#16a34a",
          background: status === "coming soon" ? "#f3f4f6" : "#f0fdf4",
          padding: "3px 8px", borderRadius: 4,
        }}>{status}</span>
      </div>
    </div>
  );
}

function ZohoCount({ marketId }: { marketId: string | null }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!marketId) return;
    setCount(null);
    fetch(`/api/onboarding/submissions/count?market=${marketId}`)
      .then(r => r.json())
      .then(j => setCount(j.count ?? 0))
      .catch(() => setCount(0));
  }, [marketId]);

  if (!marketId) return null;

  return (
    <div style={{ marginTop: 32, padding: "16px 20px", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: count === null ? "#d1d5db" : count > 0 ? "#16a34a" : "#f59e0b", flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: "#374151" }}>
        {count === null
          ? "Checking Zoho submissions…"
          : count === 0
          ? "No Zoho submissions synced yet for this market — Apps Script trigger not set up."
          : `${count} Zoho submission${count !== 1 ? "s" : ""} synced for this market.`}
      </span>
    </div>
  );
}
