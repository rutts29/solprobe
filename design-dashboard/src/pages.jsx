// Additional pages: Nodes, Alerts, Diagnoses, Training, Attestations

// ──────────────────────────────────────────────────────────────────────────
// NODES PAGE — full grid of node cards with deep metrics
// ──────────────────────────────────────────────────────────────────────────
const NodesPage = ({ density }) => {
  const [view, setView] = React.useState("grid"); // grid | table
  const [selectedNode, setSelectedNode] = React.useState(null);

  return (
    <div>
      <PageHeader
        title="Nodes"
        subtitle={<>Detail view of all <span className="mono" style={{ color: "var(--fg)" }}>{NODES.length}</span> connected sidecars</>}
        actions={
          <>
            <SegmentSwitch value={view} onChange={setView} options={[{ id: "grid", label: "Grid" }, { id: "table", label: "Table" }]} />
            <button style={btnGhostStyle}><I.Refresh size={12} /> Refresh</button>
          </>
        }
      />

      {view === "grid" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {NODES.map(n => <NodeCard key={n.node_id} n={n} onClick={() => setSelectedNode(n)} />)}
        </div>
      ) : (
        <ClusterTable nodes={NODES} density={density} />
      )}

      {selectedNode && <NodeDrawer node={selectedNode} onClose={() => setSelectedNode(null)} />}
    </div>
  );
};

const NodeCard = ({ n, onClick }) => {
  const tone = statusTone(n.status);
  const tempTone = n.temp >= 85 ? "crit" : n.temp >= 80 ? "warn" : "muted";

  return (
    <div className="card" onClick={onClick} style={{ padding: 14, cursor: "pointer", transition: "border-color 120ms" }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = "var(--border-strong)"}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <StatusDot tone={tone} pulse={n.status === "critical"} />
        <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{n.node_id}</span>
        <Pill tone="outline" style={{ fontSize: 10 }}>{n.gpu_model.replace("NVIDIA ", "")}</Pill>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)" }}>{relTime(n.last_seen_ms)}</span>
      </div>

      {/* Big metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Metric label="Temp" value={`${n.temp}°C`} tone={tempTone} />
        <Metric label="Util" value={`${n.util}%`} tone={n.util > 50 ? "ok" : "warn"} />
        <Metric label="Memory" value={`${n.mem_pct}%`} tone={n.mem_pct > 90 ? "crit" : "muted"} />
        <Metric label="Power" value={`${n.power}W`} tone="muted" />
      </div>

      {/* Mini sparkline + region */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid var(--border)" }}>
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)" }}>{n.region}</span>
        <Sparkline data={SERIES.cluster_util.map(v => v + (Math.random() - 0.5) * 4)} w={90} h={20} stroke={`var(--${tone})`} fill={`var(--${tone}-soft)`} strokeWidth={1.25} />
      </div>
    </div>
  );
};

const Metric = ({ label, value, tone }) => {
  const c = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--crit)", muted: "var(--fg)" }[tone] || "var(--fg)";
  return (
    <div>
      <div className="mono" style={{ fontSize: 9, color: "var(--fg-subtle)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
      <div className="num" style={{ fontSize: 16, fontWeight: 600, color: c, letterSpacing: -0.3 }}>{value}</div>
    </div>
  );
};

const NodeDrawer = ({ node, onClose }) => {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex" }}>
      <div onClick={onClose} style={{ flex: 1, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }} />
      <div className="card slide-in" style={{
        width: 540, height: "100%", borderRadius: 0, background: "var(--bg)",
        borderLeft: "1px solid var(--border)", overflow: "auto",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <StatusDot tone={statusTone(node.status)} pulse={node.status === "critical"} />
          <span className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{node.node_id}</span>
          <Pill tone="outline">{node.gpu_model}</Pill>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={iconBtnStyle}><I.X size={14} /></button>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            {[
              { label: "GPU Temp", value: `${node.temp}°C`, max: 100, tone: node.temp >= 85 ? "crit" : node.temp >= 80 ? "warn" : "ok" },
              { label: "Utilization", value: `${node.util}%`, max: 100, tone: "ok" },
              { label: "Memory", value: `${node.mem_pct}%`, max: 100, tone: node.mem_pct > 90 ? "crit" : "info" },
              { label: "Power", value: `${node.power}W`, max: 75, tone: "warn" },
              { label: "SM Active", value: `${node.sm}%`, max: 100, tone: "accent" },
              { label: "Tensor Active", value: `${Math.round(node.sm * 0.9)}%`, max: 100, tone: "accent" },
            ].map(m => (
              <div key={m.label} className="card" style={{ padding: 12, background: "var(--card-2)" }}>
                <div className="mono" style={{ fontSize: 9, color: "var(--fg-subtle)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{m.label}</div>
                <div className="num" style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{m.value}</div>
                <Progress value={parseFloat(m.value)} max={m.max} tone={m.tone} height={3} />
              </div>
            ))}
          </div>

          <SectionHeader>GPU utilization · last 30 min</SectionHeader>
          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <Sparkline data={SERIES.cluster_util} w={500} h={80} stroke="var(--accent)" fill="var(--accent-soft)" strokeWidth={2} />
          </div>

          <SectionHeader>Recent alerts on this node</SectionHeader>
          <div className="card" style={{ overflow: "hidden" }}>
            {ALERTS.filter(a => a.node_id === node.node_id).slice(0, 3).map((a, i, arr) => (
              <div key={a.alert_id} style={{
                padding: "10px 14px", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                borderLeft: `2px solid var(--${sevTone(a.severity)})`,
              }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <Pill tone={sevTone(a.severity)}>{a.severity}</Pill>
                  <span className="mono" style={{ fontSize: 11, fontWeight: 500 }}>{a.type}</span>
                  <span style={{ flex: 1 }} />
                  <span className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)" }}>{relTime(a.ts)}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>{a.description}</div>
              </div>
            ))}
            {ALERTS.filter(a => a.node_id === node.node_id).length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "var(--fg-subtle)", fontSize: 12 }}>No alerts on this node</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// ALERTS PAGE — full alert list with timeline
// ──────────────────────────────────────────────────────────────────────────
const AlertsPage = () => {
  const [filter, setFilter] = React.useState("all");
  const filtered = filter === "all" ? ALERTS : ALERTS.filter(a => a.severity === filter.toUpperCase());

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle={<>Live stream from <span className="mono" style={{ color: "var(--fg)" }}>edge + central</span> detectors · 14 alert types</>}
        actions={<button style={btnPrimaryStyle}><I.Plus size={12} /> Inject fault</button>}
      />

      {/* Severity summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Critical", count: ALERTS.filter(a => a.severity === "CRITICAL").length, tone: "crit" },
          { label: "Warning", count: ALERTS.filter(a => a.severity === "WARNING").length, tone: "warn" },
          { label: "Info", count: ALERTS.filter(a => a.severity === "INFO").length, tone: "info" },
          { label: "Total 24h", count: 47, tone: "muted" },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: 14 }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{s.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="num" style={{ fontSize: 24, fontWeight: 600, color: s.tone === "muted" ? "var(--fg)" : `var(--${s.tone})` }}>{s.count}</span>
              {s.tone !== "muted" && <StatusDot tone={s.tone} pulse={s.tone === "crit"} size={6} />}
            </div>
          </div>
        ))}
      </div>

      {/* Timeline + list */}
      <div className="card" style={{ marginBottom: 16, padding: 14 }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Alerts per minute · 24m</div>
        <SparkBars data={SERIES.alerts_per_m} w={1000} h={48} color="var(--crit)" />
      </div>

      <div className="card">
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6 }}>
          {["all", "critical", "warning", "info"].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: "5px 11px", fontSize: 11, fontWeight: 500,
              borderRadius: 6, border: "1px solid",
              borderColor: filter === f ? "var(--border-strong)" : "transparent",
              background: filter === f ? "var(--card-2)" : "transparent",
              color: filter === f ? "var(--fg)" : "var(--fg-subtle)",
              cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize",
            }}>{f}</button>
          ))}
          <div style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 11, color: "var(--fg-subtle)", padding: "5px 0" }}>{filtered.length} alerts</span>
        </div>
        {filtered.map(a => <AlertFullRow key={a.alert_id} a={a} />)}
      </div>
    </div>
  );
};

const AlertFullRow = ({ a }) => {
  const tone = sevTone(a.severity);
  return (
    <div style={{
      padding: "14px 16px", borderBottom: "1px solid var(--border)",
      borderLeft: `2px solid var(--${tone})`,
      display: "grid", gridTemplateColumns: "100px 1fr 200px 120px", gap: 16, alignItems: "center",
    }}>
      <Pill tone={tone}>{a.severity}</Pill>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{a.type}</span>
          <Pill tone="muted" style={{ fontSize: 9 }}>{a.source}</Pill>
        </div>
        <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>{a.description}</div>
      </div>
      <span className="mono" style={{ fontSize: 11, color: "var(--fg)" }}>{a.node_id}</span>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)" }}>{relTime(a.ts)}</span>
        <button style={iconBtnStyle}><I.ChevR size={13} /></button>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// TRAINING PAGE
// ──────────────────────────────────────────────────────────────────────────
const TrainingPage = () => {
  return (
    <div>
      <PageHeader
        title="Training"
        subtitle={<>DiLoCo distributed run · <span className="mono" style={{ color: "var(--fg)" }}>{RUN.job_id}</span></>}
        actions={<button style={btnGhostStyle}><I.Refresh size={12} /> Refresh</button>}
      />

      <div style={{ marginBottom: 20 }}><TrainingPanel /></div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <ChartCard title="Loss · last 24m" data={SERIES.loss.map(Number)} color="var(--ok)" />
        <ChartCard title="Throughput · last 24m" data={SERIES.throughput} color="var(--info)" />
        <ChartCard title="Gradient norm · last 24m" data={SERIES.grad_norm} color="var(--warn)" />
        <ChartCard title="Cluster utilization · last 24m" data={SERIES.cluster_util} color="var(--accent)" />
      </div>
    </div>
  );
};

const ChartCard = ({ title, data, color }) => (
  <div className="card" style={{ padding: 14 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
      <span className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)", textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</span>
      <span className="num" style={{ fontSize: 14, fontWeight: 600 }}>{data[data.length - 1].toFixed?.(2) ?? data[data.length - 1]}</span>
    </div>
    <Sparkline data={data} w={500} h={70} stroke={color} strokeWidth={1.75} />
  </div>
);

// ──────────────────────────────────────────────────────────────────────────
// ATTESTATIONS PAGE — Solana on-chain layer
// ──────────────────────────────────────────────────────────────────────────
const AttestationsPage = () => {
  const attestations = [
    { sig: "5Jq...8wF3", step: 14820, node: "node-3", staked: 1600, ts: Date.now() - 22_000, status: "verified" },
    { sig: "5Jq...8w8e", step: 14810, node: "node-1", staked: 1600, ts: Date.now() - 95_000, status: "verified" },
    { sig: "5Jq...8w2a", step: 14800, node: "node-7", staked: 1600, ts: Date.now() - 168_000, status: "verified" },
    { sig: "5Jq...8vfb", step: 14790, node: "node-4", staked: 1600, ts: Date.now() - 240_000, status: "verified" },
    { sig: "5Jq...8vc1", step: 14780, node: "node-0", staked: 1600, ts: Date.now() - 312_000, status: "verified" },
    { sig: "5Jq...8v98", step: 14770, node: "node-5", staked: 1600, ts: Date.now() - 384_000, status: "slashed" },
    { sig: "5Jq...8v3d", step: 14760, node: "node-6", staked: 1600, ts: Date.now() - 456_000, status: "verified" },
  ];

  return (
    <div>
      <PageHeader
        title="On-chain attestations"
        subtitle={<>4 Anchor programs · attestation, escrow, reputation, staking</>}
        actions={
          <>
            <Pill tone="accent"><I.Shield size={10} /> mainnet-beta</Pill>
            <button style={btnGhostStyle}>View on Solscan</button>
          </>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total staked", value: "12,400", suffix: "SOL", tone: "accent" },
          { label: "Attestations", value: "192", suffix: "", tone: "ok" },
          { label: "Slashed", value: "1", suffix: "this run", tone: "crit" },
          { label: "Reputation", value: "98.7", suffix: "%", tone: "ok" },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: 14 }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{s.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span className="num" style={{ fontSize: 22, fontWeight: 600, color: `var(--${s.tone})` }}>{s.value}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--fg-subtle)" }}>{s.suffix}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <I.Shield size={14} style={{ color: "var(--accent)" }} />
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Recent attestations</h3>
          <Pill tone="muted">{attestations.length}</Pill>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--card-2)", color: "var(--fg-muted)" }}>
              <th style={thStyle}></th>
              <th style={thStyle}>Signature</th>
              <th style={thStyle}>Worker</th>
              <th style={thStyle}>Step</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Staked</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {attestations.map((a, i) => (
              <tr key={a.sig} style={{ borderBottom: i < attestations.length - 1 ? "1px solid var(--border)" : "none", height: 40 }}>
                <td style={{ padding: "0 12px" }}><StatusDot tone={a.status === "slashed" ? "crit" : "ok"} /></td>
                <td style={{ padding: "0 12px", fontFamily: "var(--font-mono)", color: "var(--fg)" }}>{a.sig}</td>
                <td style={{ padding: "0 12px", fontFamily: "var(--font-mono)", color: "var(--fg-muted)" }}>{a.node}</td>
                <td style={{ padding: "0 12px", fontFamily: "var(--font-mono)", color: "var(--fg-muted)" }}>{a.step}</td>
                <td style={{ padding: "0 12px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{a.staked} SOL</td>
                <td style={{ padding: "0 12px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--fg-subtle)", fontSize: 11 }}>{relTime(a.ts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// SHARED PAGE PRIMITIVES
// ──────────────────────────────────────────────────────────────────────────
const PageHeader = ({ title, subtitle, actions }) => (
  <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 20 }}>
    <div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: -0.4 }}>{title}</h1>
      {subtitle && <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--fg-muted)" }}>{subtitle}</p>}
    </div>
    <div style={{ flex: 1 }} />
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div>
  </div>
);

const SectionHeader = ({ children }) => (
  <div className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 500, marginBottom: 8, marginTop: 4 }}>{children}</div>
);

const SegmentSwitch = ({ value, onChange, options }) => (
  <div style={{ display: "flex", padding: 2, background: "var(--card-2)", borderRadius: 8, border: "1px solid var(--border)" }}>
    {options.map(o => (
      <button key={o.id} onClick={() => onChange(o.id)} style={{
        padding: "4px 11px", fontSize: 11, fontWeight: 500,
        borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit",
        background: value === o.id ? "var(--bg)" : "transparent",
        color: value === o.id ? "var(--fg)" : "var(--fg-subtle)",
      }}>{o.label}</button>
    ))}
  </div>
);

const thStyle = {
  textAlign: "left", fontWeight: 500, fontSize: 11,
  padding: "8px 12px", letterSpacing: 0.4, textTransform: "uppercase",
  color: "var(--fg-muted)", borderBottom: "1px solid var(--border)",
};

const btnGhostStyle = {
  display: "inline-flex", alignItems: "center", gap: 5,
  padding: "6px 12px", fontSize: 12, fontWeight: 500,
  borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
  background: "var(--card)", color: "var(--fg-muted)",
  border: "1px solid var(--border)",
};
const btnPrimaryStyle = {
  display: "inline-flex", alignItems: "center", gap: 5,
  padding: "6px 12px", fontSize: 12, fontWeight: 500,
  borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
  background: "var(--accent)", color: "var(--accent-fg)",
  border: "1px solid transparent",
};
const iconBtnStyle = {
  width: 28, height: 28, display: "grid", placeItems: "center",
  borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--card)", color: "var(--fg-muted)", cursor: "pointer",
};

// ──────────────────────────────────────────────────────────────────────────
// DIAGNOSES PAGE — wraps the existing panel with summary stats
// ──────────────────────────────────────────────────────────────────────────
const DiagnosesPage = () => (
  <div>
    <PageHeader
      title="Diagnoses"
      subtitle={<>LLM root-cause analysis · auto-triggered on <span className="mono" style={{ color: "var(--crit)" }}>CRITICAL</span> alerts</>}
      actions={<Pill tone="accent"><I.Brain size={10} /> claude-haiku-4-5</Pill>}
    />

    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
      {[
        { label: "Diagnoses today", value: "23", tone: "accent" },
        { label: "Avg confidence", value: "84%", tone: "ok" },
        { label: "Avg latency", value: "1.9s", tone: "info" },
        { label: "Recovered", value: "94%", tone: "ok" },
      ].map(s => (
        <div key={s.label} className="card" style={{ padding: 14 }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{s.label}</div>
          <span className="num" style={{ fontSize: 22, fontWeight: 600, color: `var(--${s.tone})` }}>{s.value}</span>
        </div>
      ))}
    </div>

    <DiagnosesPanel diagnoses={DIAGNOSES} />
  </div>
);

Object.assign(window, { NodesPage, AlertsPage, DiagnosesPage, TrainingPage, AttestationsPage, PageHeader, btnGhostStyle, btnPrimaryStyle, iconBtnStyle });
