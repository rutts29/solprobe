// Top header bar — search, theme toggle, notifications, user

const Topbar = ({ theme, onTheme, criticalCount, breadcrumb = "overview" }) => {
  const labels = { overview: "Cluster overview", nodes: "Nodes", alerts: "Alerts", diagnoses: "Diagnoses", training: "Training", chain: "Attestations" };
  return (
    <header style={{
      height: "var(--header-h)",
      display: "flex", alignItems: "center", gap: 12,
      padding: "0 20px",
      background: "var(--bg)",
      borderBottom: "1px solid var(--border)",
      position: "sticky", top: 0, zIndex: 20,
      backdropFilter: "blur(8px)",
    }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
        <span style={{ color: "var(--fg-subtle)" }}>gke-prod-us</span>
        <I.ChevR size={12} style={{ color: "var(--fg-subtle)" }} />
        <span style={{ fontWeight: 500 }}>{labels[breadcrumb] || "Overview"}</span>
      </div>

      {/* Live tick */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "3px 8px", borderRadius: 999,
        background: "var(--ok-soft)", color: "var(--ok)",
        fontSize: 11, fontWeight: 500,
      }}>
        <StatusDot tone="ok" pulse size={6} />
        <span className="mono">LIVE</span>
        <span style={{ color: "var(--fg-subtle)", fontWeight: 400 }}>·</span>
        <span className="mono" style={{ color: "var(--fg-muted)" }}>1s</span>
      </div>

      <div style={{ flex: 1 }} />

      {/* Search */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 10px", borderRadius: 8,
        background: "var(--card-2)", border: "1px solid var(--border)",
        width: 280, color: "var(--fg-subtle)",
      }}>
        <I.Search size={14} />
        <span style={{ fontSize: 12, flex: 1 }}>Jump to node, alert, diagnosis…</span>
        <span className="mono" style={{
          fontSize: 10, padding: "1px 5px", borderRadius: 4,
          background: "var(--bg)", border: "1px solid var(--border)",
        }}>⌘K</span>
      </div>

      <div style={{ width: 1, height: 20, background: "var(--border)" }} />

      {/* Theme toggle */}
      <ThemeToggle theme={theme} onTheme={onTheme} />

      {/* Notifications */}
      <button style={iconBtn} data-tip={`${criticalCount} critical alert${criticalCount === 1 ? "" : "s"}`}>
        <I.Bell size={15} />
        {criticalCount > 0 && (
          <span style={{
            position: "absolute", top: 4, right: 4,
            width: 7, height: 7, borderRadius: 999,
            background: "var(--crit)",
            boxShadow: "0 0 0 2px var(--bg)",
          }} className="pulse-dot" />
        )}
      </button>

      <button style={iconBtn} data-tip="Settings"><I.Settings size={15} /></button>

      {/* User */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "3px 4px 3px 4px", borderRadius: 999,
        cursor: "pointer",
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 999,
          background: "linear-gradient(135deg, oklch(0.72 0.18 38), oklch(0.62 0.18 18))",
          color: "#fff", fontSize: 11, fontWeight: 600,
          display: "grid", placeItems: "center",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15)",
        }}>RT</div>
      </div>
    </header>
  );
};

const iconBtn = {
  position: "relative",
  width: 32, height: 32,
  display: "grid", placeItems: "center",
  borderRadius: 8, border: "1px solid transparent",
  background: "transparent", color: "var(--fg-muted)",
  cursor: "pointer",
};

const ThemeToggle = ({ theme, onTheme }) => {
  return (
    <div style={{
      display: "flex", padding: 2, borderRadius: 999,
      background: "var(--card-2)", border: "1px solid var(--border)",
    }}>
      {[
        { id: "light", Icon: I.Sun, label: "Light" },
        { id: "dark",  Icon: I.Moon, label: "Dark" },
      ].map(({ id, Icon, label }) => {
        const active = theme === id;
        return (
          <button
            key={id}
            onClick={() => onTheme(id)}
            data-tip={label}
            style={{
              width: 28, height: 24, display: "grid", placeItems: "center",
              borderRadius: 999, border: "none", cursor: "pointer",
              background: active ? "var(--bg)" : "transparent",
              color: active ? "var(--fg)" : "var(--fg-subtle)",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.18)" : "none",
              transition: "all 150ms",
            }}
          >
            <Icon size={13} />
          </button>
        );
      })}
    </div>
  );
};

window.Topbar = Topbar;
