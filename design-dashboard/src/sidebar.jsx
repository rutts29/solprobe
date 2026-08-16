// Sidebar navigation

const Sidebar = ({ active, onNav, alertCount, nodeCount }) => {
  const items = [
    { id: "overview",  label: "Overview",  Icon: I.Grid },
    { id: "nodes",     label: "Nodes",     Icon: I.Server,  count: nodeCount, countTone: "ok" },
    { id: "alerts",    label: "Alerts",    Icon: I.Alert,   count: alertCount, countTone: "crit" },
    { id: "diagnoses", label: "Diagnoses", Icon: I.Brain },
    { id: "training",  label: "Training",  Icon: I.Wave },
    { id: "chain",     label: "Attestations", Icon: I.Shield },
  ];

  return (
    <aside style={{
      position: "fixed", left: 0, top: 0, bottom: 0,
      width: "var(--sidebar-w)",
      background: "var(--card)",
      borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      zIndex: 30,
    }}>
      {/* Logo */}
      <div style={{
        height: "var(--header-h)",
        display: "flex", alignItems: "center", gap: 10,
        padding: "0 16px",
        borderBottom: "1px solid var(--border)",
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: "var(--logo-tile, #0a0a0f)",
          display: "grid", placeItems: "center",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}>
          <svg width="20" height="20" viewBox="0 0 120 120" fill="none" aria-label="SolProbe">
            <path d="M22 68 H40 L48 48 L56 86 L64 54 L72 72 H98"
              stroke="#fafafa" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="64" cy="54" r="7" fill="#FF6B35" />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ fontWeight: 700, letterSpacing: -0.3, fontSize: 14 }}>
            Sol<span style={{ color: "var(--fg-muted)", fontWeight: 500 }}>Probe</span>
          </span>
          <span className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)", marginTop: 2 }}>v0.4.2 · prod</span>
        </div>
      </div>

      {/* Cluster picker */}
      <div style={{ padding: "12px 12px 8px" }}>
        <button style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "8px 10px", borderRadius: 8,
          background: "var(--card-2)", border: "1px solid var(--border)",
          color: "var(--fg)", textAlign: "left", cursor: "pointer", fontFamily: "inherit",
        }}>
          <I.Layers size={14} className="text-muted" />
          <div style={{ flex: 1, lineHeight: 1.15 }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>gke-prod-us</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)" }}>8 nodes · diloco-gpt-4b</div>
          </div>
          <I.ChevD size={14} style={{ color: "var(--fg-subtle)" }} />
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ padding: "4px 8px", flex: 1 }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)", padding: "8px 8px 4px", letterSpacing: 0.6, textTransform: "uppercase" }}>
          Monitoring
        </div>
        {items.slice(0, 5).map((it) => <NavItem key={it.id} item={it} active={active === it.id} onNav={onNav} />)}

        <div className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)", padding: "16px 8px 4px", letterSpacing: 0.6, textTransform: "uppercase" }}>
          On-chain
        </div>
        {items.slice(5).map((it) => <NavItem key={it.id} item={it} active={active === it.id} onNav={onNav} />)}
      </nav>

      {/* Footer card — connection state */}
      <div style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
        <div className="card" style={{ padding: 10, background: "var(--card-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <StatusDot tone="ok" pulse size={7} />
            <span style={{ fontSize: 11, fontWeight: 500 }}>Backend live</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)", lineHeight: 1.4 }}>
            ws://api:8000/ws/stream<br />
            <span style={{ color: "var(--fg-muted)" }}>1.4 MB/s · 12ms p50</span>
          </div>
        </div>
      </div>
    </aside>
  );
};

const NavItem = ({ item, active, onNav }) => {
  const { Icon } = item;
  return (
    <button
      onClick={() => onNav(item.id)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "7px 10px", borderRadius: 6, marginBottom: 1,
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--fg-muted)",
        border: "none", cursor: "pointer",
        fontSize: 13, fontFamily: "inherit", fontWeight: active ? 500 : 400,
        textAlign: "left",
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--hover)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      <Icon size={15} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.count > 0 && <Pill tone={item.countTone} style={{ fontSize: 10, padding: "1px 6px" }}>{item.count}</Pill>}
    </button>
  );
};

window.Sidebar = Sidebar;
