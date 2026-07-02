"use client";

import { useRef, useCallback } from "react";
import Map, { Marker, Popup, NavigationControl } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useState } from "react";

type MapRow = {
  property: string;
  market: string;
  lat: number | null;
  lng: number | null;
  open_tasks: number;
  urgent_count: number;
  tomorrow: string;
};

const MARKET_CENTERS: Record<string, { longitude: number; latitude: number; zoom: number }> = {
  branson:    { longitude: -93.22, latitude: 36.64, zoom: 10 },
  deep_creek: { longitude: -79.32, latitude: 39.53, zoom: 11 },
  poconos:    { longitude: -75.25, latitude: 41.13, zoom: 10 },
};

function markerColor(row: MapRow): string {
  if (row.urgent_count > 0) return "#dc2626";
  if (row.open_tasks > 0)   return "#f59e0b";
  return "#94a3b8";
}

export default function PropertyMap({ rows, market }: { rows: MapRow[]; market: string }) {
  const [popup, setPopup] = useState<MapRow | null>(null);
  const mapCenter = MARKET_CENTERS[market] ?? { longitude: -93.22, latitude: 36.64, zoom: 9 };

  const mappable = rows.filter(r => r.lat != null && r.lng != null);

  return (
    <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginBottom: 20, height: 340 }}>
      <Map
        initialViewState={mapCenter}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
      >
        <NavigationControl position="top-right" />
        {mappable.map((row, i) => (
          <Marker
            key={i}
            longitude={row.lng!}
            latitude={row.lat!}
            anchor="center"
            onClick={e => { e.originalEvent.stopPropagation(); setPopup(row); }}
          >
            <div
              title={row.property}
              style={{
                width: row.urgent_count > 0 ? 14 : 11,
                height: row.urgent_count > 0 ? 14 : 11,
                borderRadius: "50%",
                background: markerColor(row),
                border: "2px solid #ffffff",
                boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                cursor: "pointer",
              }}
            />
          </Marker>
        ))}
        {popup && popup.lat != null && popup.lng != null && (
          <Popup
            longitude={popup.lng}
            latitude={popup.lat}
            anchor="bottom"
            offset={12}
            onClose={() => setPopup(null)}
            closeOnClick={false}
            style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
          >
            <div style={{ padding: "4px 2px", minWidth: 160 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#1a202c", marginBottom: 4 }}>{popup.property}</div>
              {popup.urgent_count > 0 && (
                <div style={{ fontSize: 11, color: "#dc2626", fontWeight: 600 }}>⚠️ {popup.urgent_count} urgent</div>
              )}
              {popup.open_tasks > 0 && (
                <div style={{ fontSize: 11, color: "#92400e" }}>{popup.open_tasks} open tasks</div>
              )}
              {popup.open_tasks === 0 && <div style={{ fontSize: 11, color: "#6b7280" }}>No open tasks</div>}
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}
