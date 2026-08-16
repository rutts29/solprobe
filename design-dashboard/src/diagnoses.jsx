// Diagnoses panel — LLM root-cause output

const DiagnosesPanel = ({ diagnoses }) => {
  const [openId, setOpenId] = React.useState(diagnoses[0]?.id);

  return (
    <div className="card">
      <div style={{
        padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid var(--border)",
      }}>
        <I.Brain size={14} style={{ color: "var(--accent)" }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Recent diagnoses</h3>
        <Pill tone="accent">claude-haiku-4-5</Pill>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)" }}>auto-triggered on CRITICAL</span>
      </div>

      <div>
        {diagnoses.map((d) => (
          <DiagnosisRow key={d.id} d={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} />
        ))}
      </div>
    </div>
  );
};

const DiagnosisRow = ({ d, open, onToggle }) => {
  const conf = (d.confidence * 100).toFixed(0);
  const confTone = d.confidence > 0.85 ? "ok" : d.confidence > 0.65 ? "warn" : "crit";
  const urgencyTone = { immediate: "crit", soon: "warn", monitor: "info" }[d.action.urgency];

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      {/* Header row */}
      <div onClick={onToggle} style={{
        padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
        transition: "background 120ms",
      }}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
      >
        <I.Brain size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, color: "var(--fg)" }}>
            {d.root_cause}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "var(--fg-subtle)" }}>
            <span className="mono" style={{ color: "var(--fg-muted)" }}>{d.node_id}</span>
            <span>·</span>
            <span className="mono">{relTime(d.ts)}</span>
            <span>·</span>
            <span className="mono">{d.latency_ms}ms</span>
            <span>·</span>
            <span className="mono">→ {d.action.name}</span>
          </div>
        </div>

        {/* Confidence bar */}
        <div style={{ width: 120, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 999, background: "var(--card-2)", border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${conf}%`, background: `var(--${confTone})` }} />
          </div>
          <span className="mono" style={{ fontSize: 11, color: "var(--fg)", minWidth: 30, textAlign: "right" }}>{conf}%</span>
        </div>

        <Pill tone={urgencyTone}>{d.action.urgency}</Pill>
        <I.ChevD size={14} style={{ color: "var(--fg-subtle)", transform: open ? "rotate(180deg)" : "none", transition: "transform 200ms" }} />
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="slide-in" style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: "1fr 280px", gap: 20 }}>
          <div>
            <SectionLabel>Reasoning</SectionLabel>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.6 }}>
              {d.reasoning}
            </p>

            <SectionLabel>Evidence chain</SectionLabel>
            <div style={{ background: "var(--card-2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
              {d.evidence.map((e, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "160px 100px 1fr",
                  gap: 12, padding: "8px 12px",
                  borderBottom: i < d.evidence.length - 1 ? "1px solid var(--border)" : "none",
                  fontSize: 11,
                }}>
                  <span className="mono" style={{ color: "var(--fg-muted)" }}>{e.metric}</span>
                  <span className="mono" style={{ color: "var(--fg)", fontWeight: 500 }}>{e.value}</span>
                  <span style={{ color: "var(--fg-subtle)" }}>{e.context}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Recommended action</SectionLabel>
            <div style={{
              padding: 12, borderRadius: 8,
              background: `var(--${urgencyTone}-soft)`,
              border: `1px solid var(--${urgencyTone})`,
              borderColor: `color-mix(in oklch, var(--${urgencyTone}) 30%, transparent)`,
              marginBottom: 16,
            }}>
              <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: `var(--${urgencyTone})`, marginBottom: 4 }}>
                {d.action.name}
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-muted)", marginBottom: 10 }}>
                target: <span className="mono">{d.action.target}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={primaryBtn(urgencyTone)}>
                  <I.Check size={11} /> Apply
                </button>
                <button style={ghostBtn}>Defer</button>
              </div>
            </div>

            {d.similar.length > 0 && (
              <>
                <SectionLabel>Similar incidents</SectionLabel>
                {d.similar.map(s => (
                  <div key={s.id} style={{
                    padding: "6px 10px", borderRadius: 6,
                    background: "var(--card-2)", border: "1px solid var(--border)",
                    fontSize: 11, color: "var(--fg-muted)", marginBottom: 4,
                    display: "flex", justifyContent: "space-between",
                  }}>
                    <span className="mono">{s.id}</span>
                    <span className="mono" style={{ color: "var(--fg-subtle)" }}>{(s.similarity * 100).toFixed(0)}% match</span>
                  </div>
                ))}
              </>
            )}

            <div style={{ marginTop: 12, fontSize: 10, color: "var(--fg-subtle)" }} className="mono">
              {d.model} · {d.latency_ms}ms · alert {d.alert_id}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SectionLabel = ({ children }) => (
  <div className="mono" style={{
    fontSize: 10, color: "var(--fg-subtle)",
    textTransform: "uppercase", letterSpacing: 0.6,
    marginBottom: 6, fontWeight: 500,
  }}>{children}</div>
);

const primaryBtn = (tone) => ({
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "5px 10px", fontSize: 11, fontWeight: 500,
  borderRadius: 6, border: "none", cursor: "pointer",
  background: `var(--${tone})`, color: "#fff", fontFamily: "inherit",
});
const ghostBtn = {
  padding: "5px 10px", fontSize: 11, fontWeight: 500,
  borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
  background: "transparent", color: "var(--fg-muted)",
  border: "1px solid var(--border)",
};

window.DiagnosesPanel = DiagnosesPanel;
