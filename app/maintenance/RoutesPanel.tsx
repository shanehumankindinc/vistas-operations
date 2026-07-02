"use client";

import { useMemo } from "react";

type RouteTask = {
  title: string;
  daysOld: string;
  daysNum: number;
  url: string;
  urgent: boolean;
};

type RouteProperty = {
  property: string;
  market: string;
  tasks: RouteTask[];
};

type RouteEmployee = {
  name: string;
  properties: RouteProperty[];
  totalTasks: number;
};

type PropertyRow = {
  market: string;
  property: string;
  maintenance_tasks: string | null;
};

// Avatar colors cycling for different employees
const AVATAR_COLORS = ["#4f7c6b", "#3b5fa0", "#7c3a6b", "#7c5c3a", "#3a6b7c", "#6b3a3a"];

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initials(name: string) {
  return name.split(" ").map(p => p[0] || "").join("").slice(0, 2).toUpperCase();
}

// task_list format: "title | Xd old | url | priority | assignee"
function parseRouteTasks(raw: string | null): { task: RouteTask; assignee: string }[] {
  if (!raw) return [];
  return raw.split("\n").map(line => {
    const parts = line.split(" | ");
    const url = parts[2] || "";
    const daysOld = parts[1] || "";
    const daysNum = parseInt(daysOld) || 0;
    const priority = parts[3] || "";
    const assignee = parts[4] || "Unassigned";
    return {
      task: { title: parts[0] || "", daysOld, daysNum, url, urgent: priority === "urgent" },
      assignee,
    };
  }).filter(t => t.task.title);
}

export default function RoutesPanel({ displayed }: { displayed: PropertyRow[] }) {
  const { routes, unassignedCount } = useMemo(() => {
    // employee name → Map<"market:property", RouteProperty>
    const employeeMap = new Map<string, Map<string, RouteProperty>>();
    let unassigned = 0;

    for (const row of displayed) {
      const parsed = parseRouteTasks(row.maintenance_tasks);
      for (const { task, assignee } of parsed) {
        if (!assignee || assignee === "Unassigned") {
          unassigned++;
          continue;
        }
        if (!employeeMap.has(assignee)) employeeMap.set(assignee, new Map());
        const propMap = employeeMap.get(assignee)!;
        const key = `${row.market}:${row.property}`;
        if (!propMap.has(key)) propMap.set(key, { property: row.property, market: row.market, tasks: [] });
        propMap.get(key)!.tasks.push(task);
      }
    }

    const routes: RouteEmployee[] = Array.from(employeeMap.entries())
      .map(([name, propMap]) => {
        const properties = Array.from(propMap.values());
        return { name, properties, totalTasks: properties.reduce((s, p) => s + p.tasks.length, 0) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { routes, unassignedCount: unassigned };
  }, [displayed]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a202c" }}>Routes</div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
          {routes.length === 0
            ? "No assigned tasks"
            : `${routes.length} technician${routes.length !== 1 ? "s" : ""} · ${routes.reduce((s, r) => s + r.totalTasks, 0)} tasks`}
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
        {routes.length === 0 && (
          <div style={{ padding: "20px 16px", color: "#94a3b8", fontSize: 12, fontStyle: "italic" }}>
            Schedule tasks to see routes here.
          </div>
        )}

        {routes.map(employee => (
          <div key={employee.name} style={{ marginBottom: 4 }}>
            {/* Employee header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 16px",
              background: "#f8fafc",
              borderTop: "1px solid #e2e8f0",
              borderBottom: "1px solid #e2e8f0",
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: "50%",
                background: avatarColor(employee.name),
                color: "#fff", fontSize: 10, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                {initials(employee.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1a202c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {employee.name}
                </div>
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", whiteSpace: "nowrap", flexShrink: 0 }}>
                {employee.totalTasks} task{employee.totalTasks !== 1 ? "s" : ""}
              </div>
            </div>

            {/* Properties */}
            {employee.properties.map((prop, pi) => (
              <div key={pi} style={{ paddingLeft: 16 }}>
                {/* Property name */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "6px 16px 4px 8px",
                  borderBottom: "1px solid #f1f5f9",
                }}>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>📍</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {prop.property}
                  </span>
                </div>

                {/* Tasks */}
                {prop.tasks.map((task, ti) => (
                  <div key={ti} style={{
                    display: "flex", alignItems: "baseline", gap: 4,
                    padding: "3px 16px 3px 20px",
                    borderBottom: ti < prop.tasks.length - 1 ? "1px solid #f8fafc" : "none",
                  }}>
                    {task.urgent && <span style={{ fontSize: 10, flexShrink: 0 }}>⚠️</span>}
                    <span style={{
                      fontSize: 11, color: "#4b5563", flex: 1, minWidth: 0,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }} title={task.title}>
                      {task.title}
                    </span>
                    <span style={{
                      fontSize: 10, whiteSpace: "nowrap", flexShrink: 0,
                      color: task.daysNum >= 7 ? "#dc2626" : "#9ca3af",
                      fontWeight: task.daysNum >= 7 ? 600 : 400,
                    }}>
                      {task.daysOld}
                    </span>
                    {task.url && (
                      <a href={task.url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 10, color: "#3b82f6", flexShrink: 0, textDecoration: "none" }}>
                        ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}

        {unassignedCount > 0 && (
          <div style={{ padding: "10px 16px", color: "#94a3b8", fontSize: 11, borderTop: "1px solid #f1f5f9" }}>
            + {unassignedCount} unassigned task{unassignedCount !== 1 ? "s" : ""} not shown
          </div>
        )}
      </div>
    </div>
  );
}
