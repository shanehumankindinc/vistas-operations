"use client";

import { useState, useEffect, useRef } from "react";

type OpenTask = {
  title: string;
  daysOld: string;
  daysNum: number;
  url: string;
  taskId: string;
  urgent: boolean;
};

type BzUser = { id: string | number; name: string };

type PropertyRow = {
  market: string;
  property: string;
  tomorrow: string;
  check_in_date: string | null;
  check_out_date: string | null;
  open_tasks: number;
  urgent_count: number;
  maintenance_tasks: string | null;
};

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

function parseOpenTasks(raw: string | null): OpenTask[] {
  if (!raw) return [];
  return raw.split("\n").map(line => {
    const parts = line.split(" | ");
    const url = parts[2] || "";
    const taskId = url.split("/").pop() || "";
    const daysOld = parts[1] || "";
    const daysNum = parseInt(daysOld) || 0;
    return {
      title: parts[0] || "",
      daysOld, daysNum, url, taskId,
      urgent: (parts[3] || "") === "urgent",
    };
  }).filter(t => t.title && t.taskId);
}

function fmtDate(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

type SaveResult = { taskIds: string[]; assigneeName: string };

export default function ScheduleModal({
  row,
  date,
  onClose,
}: {
  row: PropertyRow;
  date: string;
  onClose: (result?: SaveResult) => void;
}) {
  const [bzUsers, setBzUsers] = useState<BzUser[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [assigneeId, setAssigneeId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  const openTasks = parseOpenTasks(row.maintenance_tasks);
  const occ = DAY_TYPE_COLORS[row.tomorrow] || { bg: "#f1f5f9", text: "#64748b" };

  useEffect(() => {
    fetch(`/api/maintenance/bz-users?market=${encodeURIComponent(row.market)}`)
      .then(r => r.json())
      .then(j => {
        if (j.users && Array.isArray(j.users)) setBzUsers(j.users);
      })
      .catch(() => {})
      .finally(() => setUsersLoaded(true));
  }, [row.market]);

  function toggleTask(taskId: string) {
    setSelectedTasks(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }

  async function handleSave() {
    if (selectedTasks.size === 0) { setSaveError("Select at least one task."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const assigneeName = assigneeId
        ? (bzUsers.find(u => String(u.id) === assigneeId)?.name || "Unassigned")
        : "Unassigned";
      const res = await fetch("/api/maintenance/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market: row.market,
          taskIds: Array.from(selectedTasks),
          assigneeId: assigneeId || null,
          assigneeName,
          scheduledDate: date,
        }),
      });
      const j = await res.json();
      if (!res.ok || j.error) { setSaveError(j.error || "Failed to schedule."); }
      else {
        setSaved(true);
        setTimeout(() => onClose({ taskIds: Array.from(selectedTasks), assigneeName }), 1200);
      }
    } catch {
      setSaveError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15, 23, 42, 0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{
        background: "#ffffff", borderRadius: 12,
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        width: "100%", maxWidth: 480,
        maxHeight: "90vh", overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a202c" }}>Schedule Tasks</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{row.property}</div>
          </div>
          <button onClick={() => onClose()} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1 }}>

          {/* Date — greyed, non-editable */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Scheduled Date</label>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#6b7280", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 7, padding: "8px 12px" }}>
              {fmtDate(date)}
            </div>
          </div>

          {/* Occupancy */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Occupancy Status</label>
            <span style={{ display: "inline-block", background: occ.bg, color: occ.text, fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 10 }}>
              {DAY_TYPE_LABELS[row.tomorrow] || row.tomorrow}
            </span>
          </div>

          {/* Task selection */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
              Open Tasks <span style={{ color: "#d1d5db", fontWeight: 400 }}>— select to schedule</span>
            </label>
            {openTasks.length === 0 ? (
              <div style={{ fontSize: 13, color: "#6b7280", fontStyle: "italic" }}>No open tasks.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {openTasks.map(task => {
                  const checked = selectedTasks.has(task.taskId);
                  return (
                    <label key={task.taskId} style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "8px 10px", borderRadius: 7, cursor: "pointer",
                      border: `1px solid ${checked ? "#bfdbfe" : "#e5e7eb"}`,
                      background: checked ? "#eff6ff" : "#fafafa",
                      transition: "all 0.1s",
                    }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTask(task.taskId)}
                        style={{ marginTop: 1, flexShrink: 0, accentColor: "#3b82f6" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          {task.urgent && <span style={{ fontSize: 12 }}>⚠️</span>}
                          <span style={{ fontSize: 13, color: "#1a202c", fontWeight: checked ? 600 : 400 }}>{task.title}</span>
                        </div>
                        <div style={{ fontSize: 11, color: task.daysNum >= 7 ? "#dc2626" : "#9ca3af", marginTop: 2 }}>
                          {task.daysOld}
                          {task.url && (
                            <a href={task.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 6, color: "#3b82f6", textDecoration: "none" }}>↗</a>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Assignee */}
          <div style={{ marginBottom: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Assign To</label>
            {!usersLoaded ? (
              <div style={{ fontSize: 12, color: "#9ca3af" }}>Loading staff…</div>
            ) : bzUsers.length > 0 ? (
              <select
                value={assigneeId}
                onChange={e => setAssigneeId(e.target.value)}
                style={{
                  width: "100%", fontSize: 13, padding: "8px 10px",
                  border: "1px solid #e5e7eb", borderRadius: 7,
                  background: "#ffffff", color: "#1a202c", outline: "none",
                }}
              >
                <option value="">Unassigned</option>
                {bzUsers.map(u => (
                  <option key={u.id} value={String(u.id)}>{u.name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                placeholder="Enter assignee name (optional)"
                value={assigneeId}
                onChange={e => setAssigneeId(e.target.value)}
                style={{
                  width: "100%", fontSize: 13, padding: "8px 10px",
                  border: "1px solid #e5e7eb", borderRadius: 7,
                  background: "#ffffff", color: "#1a202c", outline: "none", boxSizing: "border-box",
                }}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
          {saveError && <div style={{ fontSize: 12, color: "#dc2626", flex: 1 }}>{saveError}</div>}
          {saved && <div style={{ fontSize: 12, color: "#16a34a", flex: 1, fontWeight: 600 }}>Saved!</div>}
          <button onClick={() => onClose()} style={{ padding: "8px 16px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 7, background: "#ffffff", color: "#374151", cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || saved || selectedTasks.size === 0}
            style={{
              padding: "8px 20px", fontSize: 13, fontWeight: 600,
              border: "none", borderRadius: 7, cursor: saving || saved || selectedTasks.size === 0 ? "not-allowed" : "pointer",
              background: saved ? "#16a34a" : selectedTasks.size === 0 ? "#e5e7eb" : "#1d4ed8",
              color: selectedTasks.size === 0 ? "#9ca3af" : "#ffffff",
              minWidth: 80,
            }}
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
