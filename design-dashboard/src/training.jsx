// Training run panel — DiLoCo job status with sparklines

const TrainingPanel = () => {
  const r = RUN;
  const stepPct = (r.step / r.total_steps) * 100;

  const stats = [
    { label: "Loss",       value: r.loss.toFixed(3),       delta: "−1.0%", tone: "ok",     spark: SERIES.loss.map(Number), color: "var(--ok)" },
    { label: "Throughput", value: r.throughput_tps.toLocaleString(), suffix: "tok/s", delta: "−5.2%", tone: "warn", spark: SERIES.throughput, color: "var(--info)" },
    { label: "MFU",        value: r.mfu + "%",             delta: "+0.4pp", tone: "ok",    spark: SERIES.cluster_util, color: "var(--accent)" },
    { label: "Grad norm",  value: r.grad_norm || "1.42",   delta: "+0.6", tone: "warn",     spark: SERIES.grad_norm, color: "var(--warn)" },
  ];

  return (
    <div className="card">
      <div style={{
        padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid var(--border)",
      }}>
        <I.Wave size={14} style={{ color: "var(--info)" }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Active training run</h3>
        <Pill tone="info" style={{ fontSize: 10 }}>DiLoCo</Pill>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--fg)" }}>{r.job_id}</span>
      </div>

      {/* Progress band */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <span className="num" style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>{r.step.toLocaleString()}</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--fg-subtle)", marginLeft: 6 }}>/ {r.total_steps.toLocaleString()} steps</span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>
            outer {r.outer_step} · inner {r.inner_step} · sync {r.sync_ms}ms
          </div>
        </div>
        <div style={{
          height: 6, borderRadius: 999,
          background: "var(--card-2)", border: "1px solid var(--border)", overflow: "hidden", position: "relative",
        }}>
          <div style={{
            height: "100%", width: `${stepPct}%`,
            background: "linear-gradient(90deg, var(--accent), oklch(0.7 0.16 235))",
          }} />
        </div>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)", marginTop: 4 }}>
          {stepPct.toFixed(1)}% · ~14h to complete at current throughput
        </div>
      </div>

      {/* Stat grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
        {stats.map((s, i) => (
          <div key={s.label} style={{
            padding: "12px 14px",
            borderRight: i < stats.length - 1 ? "1px solid var(--border)" : "none",
          }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{s.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
              <span className="num" style={{ fontSize: 16, fontWeight: 600 }}>{s.value}</span>
              {s.suffix && <span className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)" }}>{s.suffix}</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <span className="mono" style={{ fontSize: 10, color: `var(--${s.tone})` }}>{s.delta}</span>
              <Sparkline data={s.spark} w={56} h={18} stroke={s.color} strokeWidth={1.25} fillOpacity={0.18} />
            </div>
          </div>
        ))}
      </div>

      {/* Attestation footer */}
      <div style={{
        padding: "10px 16px",
        borderTop: "1px solid var(--border)",
        background: "var(--card-2)",
        display: "flex", alignItems: "center", gap: 12,
        fontSize: 11,
      }}>
        <I.Shield size={12} style={{ color: "var(--accent)" }} />
        <span style={{ color: "var(--fg-muted)" }}>On-chain attestations</span>
        <span className="mono" style={{ color: "var(--fg)", fontWeight: 500 }}>{r.attestations}</span>
        <span style={{ color: "var(--fg-subtle)" }}>·</span>
        <span style={{ color: "var(--fg-muted)" }}>Staked</span>
        <span className="mono" style={{ color: "var(--fg)", fontWeight: 500 }}>{r.staked_sol} SOL</span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)" }}>last attest 22s ago</span>
      </div>
    </div>
  );
};

window.TrainingPanel = TrainingPanel;
