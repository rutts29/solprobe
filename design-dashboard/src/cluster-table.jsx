// Cluster nodes table — dense, Datadog-style

const ClusterTable = ({ nodes, density = "comfortable" }) => {
  const [sortBy, setSortBy] = React.useState("status");
  const [filter, setFilter] = React.useState("all"); // all | issues

  const sorted = React.useMemo(() => {
    const list = filter === "issues" ? nodes.filter(n => n.status !== "healthy") : [...nodes];
    const order = { critical: 0, warning: 1, healthy: 2 };
    if (sortBy === "status") list.sort((a, b) => order[a.status] - order[b.status]);
    else if (sortBy === "temp") list.sort((a, b) => b.temp - a.temp);
    else if (sortBy === "util") list.sort((a, b) => b.util - a.util);
    else if (sortBy === "mem")  list.sort((a, b) => b.mem_pct - a.mem_pct);
    return list;
  }, [nodes, sortBy, filter]);

  const rowH = density === "compact" ? 36 : 44;

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <I.Server size={14} style={{ color: "var(--fg-muted)" }} />
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Cluster nodes</h3>
          <Pill tone="muted">{nodes.length}</Pill>
        </div>
        <div style={{ flex: 1 }} />
        {/* Filter chips */}
        <div style={{ display: "flex", gap: 4, padding: 2, background: "var(--card-2)", borderRadius: 8, border: "1px solid var(--border)" }}>
          {[
            { id: "all", label: "All" },
            { id: "issues", label: "Issues" },
          ].map(t => (
            <button key={t.id} onClick={() => setFilter(t.id)}
              style={{
                padding: "3px 10px", fontSize: 11, fontWeight: 500,
                borderRadius: 6, border: "none", cursor: "pointer",
                background: filter === t.id ? "var(--bg)" : "transparent",
                color: filter === t.id ? "var(--fg)" : "var(--fg-subtle)",
                fontFamily: "inherit",
              }}>{t.label}</button>
          ))}
        </div>
        <button style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "5px 9px", fontSize: 11, fontWeight: 500,
          borderRadius: 6, border: "1px solid var(--border)",
          background: "var(--card-2)", color: "var(--fg-muted)", cursor: "pointer", fontFamily: "inherit",
        }}>
          <I.Filter size={11} /> Filter
        </button>
      </div>

      {/* Table */}
      <div style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--card-2)", color: "var(--fg-muted)" }}>
              <Th onClick={() => setSortBy("status")} active={sortBy === "status"} style={{ width: 32 }}></Th>
              <Th onClick={() => setSortBy("node")} active={sortBy === "node"}>Node</Th>
              <Th>GPU</Th>
              <Th>Region</Th>
              <Th onClick={() => setSortBy("temp")} active={sortBy === "temp"} align="right">Temp</Th>
              <Th onClick={() => setSortBy("util")} active={sortBy === "util"}>Utilization</Th>
              <Th onClick={() => setSortBy("mem")} active={sortBy === "mem"}>Memory</Th>
              <Th align="right">Power</Th>
              <Th align="right">Last seen</Th>
              <Th style={{ width: 32 }}></Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((n, i) => (
              <NodeRow key={n.node_id} n={n} rowH={rowH} last={i === sorted.length - 1} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Th = ({ children, onClick, active, align = "left", style = {} }) => (
  <th
    onClick={onClick}
    style={{
      textAlign: align, fontWeight: 500, fontSize: 11,
      padding: "8px 12px", letterSpacing: 0.4, textTransform: "uppercase",
      cursor: onClick ? "pointer" : "default",
      color: active ? "var(--fg)" : "var(--fg-muted)",
      borderBottom: "1px solid var(--border)",
      whiteSpace: "nowrap",
      ...style,
    }}
  >{children}</th>
);

const NodeRow = ({ n, rowH, last }) => {
  const stale = (Date.now() - n.last_seen_ms) > 10_000;
  const tempTone = n.temp >= 85 ? "crit" : n.temp >= 80 ? "warn" : "muted";

  return (
    <tr style={{
      height: rowH,
      borderBottom: last ? "none" : "1px solid var(--border)",
      transition: "background 100ms",
    }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
    >
      <td style={td}><StatusDot tone={statusTone(n.status)} pulse={n.status === "critical"} /></td>
      <td style={{ ...td, ...tdMono, fontWeight: 500, color: "var(--fg)" }}>
        {n.node_id}
        {n.status === "critical" && <span style={{ marginLeft: 6 }}><Pill tone="crit" style={{ fontSize: 9 }}>STALE</Pill></span>}
      </td>
      <td style={{ ...td, color: "var(--fg-muted)" }}>{n.gpu_model.replace("NVIDIA ", "")}</td>
      <td style={{ ...td, ...tdMono, color: "var(--fg-subtle)", fontSize: 11 }}>{n.region}</td>
      <td style={{ ...td, ...tdMono, textAlign: "right", color: tempTone === "muted" ? "var(--fg)" : `var(--${tempTone})`, fontWeight: tempTone !== "muted" ? 500 : 400 }}>
        {n.temp}°C
      </td>
      <td style={td}>
        <CellBar value={n.util} tone={n.util > 50 ? "ok" : n.util > 20 ? "warn" : "crit"} />
      </td>
      <td style={td}>
        <CellBar value={n.mem_pct} tone={n.mem_pct > 90 ? "crit" : n.mem_pct > 75 ? "warn" : "info"} />
      </td>
      <td style={{ ...td, ...tdMono, textAlign: "right", color: "var(--fg-muted)" }}>{n.power}W</td>
      <td style={{ ...td, ...tdMono, textAlign: "right", color: stale ? "var(--crit)" : "var(--fg-subtle)" }}>{relTime(n.last_seen_ms)}</td>
      <td style={td}>
        <button style={{
          width: 22, height: 22, display: "grid", placeItems: "center",
          background: "transparent", border: "none", color: "var(--fg-subtle)", cursor: "pointer",
          borderRadius: 4,
        }}><I.ChevR size={13} /></button>
      </td>
    </tr>
  );
};

const td = { padding: "0 12px", verticalAlign: "middle" };
const tdMono = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

const CellBar = ({ value, tone }) => {
  const c = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--crit)", info: "var(--info)" }[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 110 }}>
      <div style={{
        flex: 1, height: 4, borderRadius: 999,
        background: "var(--card-2)", overflow: "hidden",
        border: "1px solid var(--border)",
      }}>
        <div style={{ height: "100%", width: `${value}%`, background: c, transition: "width 200ms" }} />
      </div>
      <span className="mono" style={{ fontSize: 11, color: "var(--fg)", minWidth: 32, textAlign: "right" }}>{value}%</span>
    </div>
  );
};

window.ClusterTable = ClusterTable;
