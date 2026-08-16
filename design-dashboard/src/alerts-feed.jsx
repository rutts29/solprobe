// Live alerts feed — right rail

const AlertsFeed = ({ alerts }) => {
  const [filter, setFilter] = React.useState("all");
  const filtered = filter === "all" ? alerts : alerts.filter(a => a.severity === filter.toUpperCase());

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid var(--border)",
      }}>
        <I.Alert size={14} style={{ color: "var(--fg-muted)" }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Alert stream</h3>
        <StatusDot tone="crit" pulse size={6} />
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)" }}>last 30m</span>
      </div>

      {/* Filter tabs */}
      <div style={{ padding: "8px 12px", display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
        {[
          { id: "all", label: "All", count: alerts.length },
          { id: "critical", label: "Critical", count: alerts.filter(a => a.severity === "CRITICAL").length, tone: "crit" },
          { id: "warning", label: "Warn", count: alerts.filter(a => a.severity === "WARNING").length, tone: "warn" },
          { id: "info", label: "Info", count: alerts.filter(a => a.severity === "INFO").length, tone: "info" },
        ].map(t => {
          const active = filter === t.id;
          return (
            <button key={t.id} onClick={() => setFilter(t.id)} style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "4px 9px", fontSize: 11, fontWeight: 500,
              borderRadius: 6, border: "1px solid",
              borderColor: active ? "var(--border-strong)" : "transparent",
              background: active ? "var(--card-2)" : "transparent",
              color: active ? "var(--fg)" : "var(--fg-subtle)",
              cursor: "pointer", fontFamily: "inherit",
            }}>
              {t.label}
              <span className="mono" style={{ fontSize: 10, color: t.tone ? `var(--${t.tone})` : "var(--fg-subtle)" }}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
        {filtered.map((a, i) => <AlertRow key={a.alert_id} a={a} flash={i === 0} />)}
        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--fg-subtle)", fontSize: 12 }}>
            No alerts in this view
          </div>
        )}
      </div>
    </div>
  );
};

const AlertRow = ({ a, flash }) => {
  const tone = sevTone(a.severity);
  const border = `var(--${tone})`;
  return (
    <div className={flash ? "flash" : ""} style={{
      padding: "10px 16px 10px 12px",
      borderBottom: "1px solid var(--border)",
      borderLeft: `2px solid ${border}`,
      cursor: "pointer",
      transition: "background 120ms",
    }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Pill tone={tone}>{a.severity}</Pill>
        <span className="mono" style={{ fontSize: 11, color: "var(--fg)", fontWeight: 500 }}>{a.type}</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)" }}>{relTime(a.ts)}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 6, lineHeight: 1.4 }}>
        {a.description}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
        <Pill tone="outline" style={{ fontSize: 10 }}>{a.node_id}</Pill>
        <Pill tone="muted" style={{ fontSize: 10 }}>{a.source}</Pill>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ color: "var(--fg-subtle)" }}>conf {(a.confidence * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
};

window.AlertsFeed = AlertsFeed;
