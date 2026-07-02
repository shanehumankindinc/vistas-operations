"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

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

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6f9", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#1a202c" }}>
      {/* Nav */}
      <nav style={{ background: "#1e293b", borderBottom: "1px solid #334155", padding: "0 24px", display: "flex", alignItems: "center", height: 52 }}>
        <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", marginRight: 28 }}>
          <span style={{ color: "#ffffff" }}>Vistas</span> Ops
        </span>
        <a href="/onboarding" style={{ fontSize: 13, fontWeight: 500, color: "#ffffff", textDecoration: "none", padding: "0 14px", height: 52, display: "flex", alignItems: "center", borderBottom: "2px solid #ffffff" }}>Onboarding</a>
        <a href="/" style={{ fontSize: 13, fontWeight: 500, color: "#94a3b8", textDecoration: "none", padding: "0 14px", height: 52, display: "flex", alignItems: "center", borderBottom: "2px solid transparent" }}>Cleaning</a>
        {(currentUser?.role === "admin" || currentUser?.role === "employee") && (
          <a href="/maintenance" style={{ fontSize: 13, fontWeight: 500, color: "#94a3b8", textDecoration: "none", padding: "0 14px", height: 52, display: "flex", alignItems: "center", borderBottom: "2px solid transparent" }}>Maintenance</a>
        )}
        <div style={{ flex: 1 }} />
        <div ref={userMenuRef} style={{ position: "relative" }}>
          <button onClick={() => setShowUserMenu(v => !v)} style={{
            width: 32, height: 32, borderRadius: "50%", border: "none",
            background: currentUser ? "#4f7c6b" : "#334155",
            color: "#ffffff", fontWeight: 700, fontSize: 12, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }} title={currentUser?.name || "Account"}>
            {currentUser
              ? currentUser.name.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase()
              : "?"}
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
        <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Property Onboarding</span>
      </div>

      {/* Placeholder body */}
      <div style={{ maxWidth: 900, margin: "60px auto", padding: "0 28px", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🏗️</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a202c", margin: "0 0 12px" }}>Onboarding</h1>
        <p style={{ fontSize: 15, color: "#6b7280", maxWidth: 480, margin: "0 auto" }}>
          Property onboarding tools — OTA listing writer, Breezeway sync, and tag detection — coming soon.
        </p>
      </div>
    </div>
  );
}
