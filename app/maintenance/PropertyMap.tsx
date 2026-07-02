"use client";

import { useRef, useState, useEffect } from "react";
import Map, { Marker, Popup, NavigationControl } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

type MapRow = {
  property: string;
  market: string;
  lat: number | null;
  lng: number | null;
  open_tasks: number;
  urgent_count: number;
  urgent_titles: string | null;
  tomorrow: string;
  check_in_date: string | null;
  check_out_date: string | null;
  maintenance_tasks: string | null;
};

type FocusProp = { lat: number; lng: number } | null;

const MARKET_CENTERS: Record<string, { longitude: number; latitude: number; zoom: number }> = {
  branson:    { longitude: -93.22, latitude: 36.64, zoom: 10 },
  deep_creek: { longitude: -79.32, latitude: 39.53, zoom: 11 },
  poconos:    { longitude: -75.25, latitude: 41.13, zoom: 10 },
};

const OCCUPANCY_MARKER_COLORS: Record<string, string> = {
  vacant:         "#94a3b8",
  checkin:        "#16a34a",
  checkout:       "#3b82f6",
  turn:           "#f97316",
  guest_occupied: "#7c3aed",
  owner_occupied: "#ca8a04",
};

const DAY_TYPE_LABELS: Record<string, string> = {
  vacant: "Vacant", checkin: "Check-in", checkout: "Check-out",
  turn: "Turn", guest_occupied: "Occupied", owner_occupied: "Owner",
};

const DAY_TYPE_BG: Record<string, { bg: string; text: string }> = {
  vacant:         { bg: "#f1f5f9", text: "#64748b" },
  checkin:        { bg: "#dcfce7", text: "#16a34a" },
  checkout:       { bg: "#dbeafe", text: "#1d4ed8" },
  turn:           { bg: "#fed7aa", text: "#c2410c" },
  guest_occupied: { bg: "#ede9fe", text: "#7c3aed" },
  owner_occupied: { bg: "#fef9c3", text: "#92400e" },
};

function parseTopTasks(raw: string | null, max = 3): string[] {
  if (!raw) return [];
  return raw.split("\n").slice(0, max).map(line => line.split(" | ")[0] || "").filter(Boolean);
}

export default function PropertyMap({
  rows,
  market,
  focusProp,
}: {
  rows: MapRow[];
  market: string;
  focusProp?: FocusProp;
}) {
  const mapRef = useRef<MapRef>(null);
  const [popup, setPopup] = useState<MapRow | null>(null);
  const mapCenter = MARKET_CENTERS[market] ?? { longitude: -93.22, latitude: 36.64, zoom: 9 };

  useEffect(() => {
    if (!focusProp || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [focusProp.lng, focusProp.lat],
      zoom: 15,
      duration: 900,
    });
    // find and show the popup for this property
    const match = rows.find(r => r.lat === focusProp.lat && r.lng === focusProp.lng);
    if (match) setPopup(match);
  }, [focusProp]); // eslint-disable-line react-hooks/exhaustive-deps

  const mappable = rows.filter(r => r.lat != null && r.lng != null);

  return (
    <div style={{
      borderRadius: 10, overflow: "hidden",
      border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      marginBottom: 20, height: 340,
    }}>
      <Map
        ref={mapRef}
        initialViewState={mapCenter}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
      >
        <NavigationControl position="top-right" />

        {mappable.map((row, i) => {
          const color = OCCUPANCY_MARKER_COLORS[row.tomorrow] ?? "#94a3b8";
          const hasUrgent = row.urgent_count > 0;
          const size = hasUrgent ? 16 : 11;

          return (
            <Marker
              key={i}
              longitude={row.lng!}
              latitude={row.lat!}
              anchor="center"
              onClick={e => { e.originalEvent.stopPropagation(); setPopup(row); }}
            >
              <div style={{ position: "relative", cursor: "pointer" }} title={row.property}>
                <div style={{
                  width: size, height: size, borderRadius: "50%",
                  background: color,
                  border: "2px solid #ffffff",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                }} />
                {hasUrgent && (
                  <span style={{
                    position: "absolute", top: -10, left: "50%",
                    transform: "translateX(-50%)",
                    fontSize: 11, lineHeight: 1, pointerEvents: "none",
                  }}>🔥</span>
                )}
              </div>
            </Marker>
          );
        })}

        {popup && popup.lat != null && popup.lng != null && (() => {
          const occ = DAY_TYPE_BG[popup.tomorrow] || { bg: "#f1f5f9", text: "#64748b" };
          const tasks = parseTopTasks(popup.maintenance_tasks, 4);
          const totalTasks = popup.open_tasks + popup.urgent_count;
          return (
            <Popup
              longitude={popup.lng}
              latitude={popup.lat}
              anchor="bottom"
              offset={12}
              onClose={() => setPopup(null)}
              closeOnClick={false}
              style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
            >
              <div style={{ padding: "4px 2px", minWidth: 180, maxWidth: 240 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#1a202c", marginBottom: 6 }}>
                  {popup.property}
                </div>
                <span style={{
                  display: "inline-block",
                  background: occ.bg, color: occ.text,
                  fontSize: 10, fontWeight: 600,
                  padding: "2px 7px", borderRadius: 10, marginBottom: 6,
                }}>
                  {DAY_TYPE_LABELS[popup.tomorrow] || popup.tomorrow}
                </span>
                <div style={{ fontSize: 11, color: "#374151", marginBottom: tasks.length ? 6 : 0 }}>
                  {totalTasks === 0
                    ? <span style={{ color: "#6b7280" }}>No open tasks</span>
                    : (
                      <>
                        {popup.urgent_count > 0 && (
                          <span style={{ color: "#dc2626", fontWeight: 700, marginRight: 6 }}>
                            🔥 {popup.urgent_count} urgent
                          </span>
                        )}
                        {popup.open_tasks > 0 && (
                          <span style={{ color: "#92400e" }}>
                            {popup.open_tasks} open
                          </span>
                        )}
                      </>
                    )}
                </div>
                {tasks.length > 0 && (
                  <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 5 }}>
                    {tasks.map((t, ti) => (
                      <div key={ti} style={{ fontSize: 11, color: "#4b5563", lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        · {t}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Popup>
          );
        })()}
      </Map>
    </div>
  );
}
