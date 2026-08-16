// KPI strip — cluster-level numbers with sparklines

const KPIStrip = ({ variant = "strip" }) => {
  const cards = [
    {
      key: "nodes",  label: "Connected nodes", value: "7", suffix: "/ 8",
      delta: { dir: "down", text: "node-5 stale" }, deltaTone: "warn",
      sparkData: SERIES.cluster_util, sparkColor: "var(--accent)",
      Icon: I.Server, tone: "ok",
    },
    {
      key: "alerts", label: "Active alerts", value: "4", suffix: "now",
      delta: { dir: "up", text: "+2 last 5m" }, deltaTone: "crit",
      sparkData: SERIES.alerts_per_m, kind: "bars", sparkColor: "var(--crit)",
      Icon: I.Alert, tone: "crit",
    },
    {
      key: "util",   label: "Avg GPU util", value: "78.4", suffix: "%",
      delta: { dir: "down", text: "−4.2% vs 1h" }, deltaTone: "warn",
      sparkData: SERIES.cluster_util, sparkColor: "var(--ok)",
      Icon: I.Cpu, tone: "ok",
    },
    {
      key: "tps",    label: "Throughput", value: "16,019", suffix: "tok/s",
      delta: { dir: "down", text: "straggler" }, deltaTone: "warn",
      sparkData: SERIES.throughput, sparkColor: "var(--info)",
      Icon: I.Bolt, tone: "info",
    },
    {
      key: "diag",   label: "Diagnoses (24h)", value: "23", suffix: "",
      delta: { dir: "up", text: "94% recovered" }, deltaTone: "ok",
      sparkData: SERIES.grad_norm, sparkColor: "var(--accent)",
      Icon: I.Brain, tone: "accent",
    },
    {
      key: "stake",  label: "Total staked", value: "12,400", suffix: "SOL",
      delta: { dir: "flat", text: "192 attested" }, deltaTone: "ok",
      sparkData: SERIES.cluster_temp, sparkColor: "var(--accent)",
      Icon: I.Coin, tone: "accent",
    },
  ];

  if (variant === "hero") {
    // Single unified card with dividers — denser, very Linear-like
    return (
      <div className="card" style={{ display: "grid", gridTemplateColumns: `repeat(${cards.length}, 1fr)`, padding: 0 }}>
        {cards.map((c, i) => (
          <div key={c.key} style={{
            padding: "16px 20px",
            borderRight: i < cards.length - 1 ? "1px solid var(--border)" : "none",
          }}>
            <KPIInner {...c} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
      {cards.map((c) => (
        <div key={c.key} className="card" style={{ padding: 14 }}>
          <KPIInner {...c} />
        </div>
      ))}
    </div>
  );
};

const KPIInner = ({ label, value, suffix, delta, deltaTone, sparkData, sparkColor, kind, Icon, tone }) => {
  const toneColor = { ok: "var(--ok)", crit: "var(--crit)", warn: "var(--warn)", info: "var(--info)", accent: "var(--accent)" }[tone] || "var(--fg-muted)";
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <Icon size={13} style={{ color: toneColor }} />
        <span style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.6, color: "var(--fg)" }}>{value}</span>
        {suffix && <span className="mono" style={{ fontSize: 11, color: "var(--fg-subtle)" }}>{suffix}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: `var(--${deltaTone === "ok" ? "ok" : deltaTone === "crit" ? "crit" : deltaTone === "warn" ? "warn" : "fg-muted"})` }}>
          {delta.dir === "up" && <I.ArrowUp size={11} />}
          {delta.dir === "down" && <I.ArrowDn size={11} />}
          {delta.dir === "flat" && <span style={{ width: 11, height: 1.5, background: "currentColor", display: "inline-block" }} />}
          <span className="mono">{delta.text}</span>
        </div>
        <div style={{ flexShrink: 0 }}>
          {kind === "bars"
            ? <SparkBars data={sparkData} w={64} h={22} color={sparkColor} />
            : <Sparkline data={sparkData} w={64} h={22} stroke={sparkColor} fillOpacity={0.18} />}
        </div>
      </div>
    </>
  );
};

window.KPIStrip = KPIStrip;
