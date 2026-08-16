// Shared visual primitives — pills, sparklines, dot, progress

const Pill = ({ children, tone = "muted", className = "", style = {} }) => {
  const map = {
    muted:    { bg: "var(--card-2)",  fg: "var(--fg-muted)", bd: "var(--border)" },
    accent:   { bg: "var(--accent-soft)", fg: "var(--accent)", bd: "transparent" },
    ok:       { bg: "var(--ok-soft)",  fg: "var(--ok)",   bd: "transparent" },
    warn:     { bg: "var(--warn-soft)",fg: "var(--warn)", bd: "transparent" },
    crit:     { bg: "var(--crit-soft)",fg: "var(--crit)", bd: "transparent" },
    info:     { bg: "var(--info-soft)",fg: "var(--info)", bd: "transparent" },
    outline:  { bg: "transparent",     fg: "var(--fg-muted)", bd: "var(--border-strong)" },
  };
  const t = map[tone] || map.muted;
  return (
    <span
      className={"mono " + className}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 7px", borderRadius: 999, fontSize: 11, fontWeight: 500,
        background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
        whiteSpace: "nowrap", letterSpacing: 0.2,
        ...style,
      }}
    >{children}</span>
  );
};

const StatusDot = ({ tone = "ok", pulse = false, size = 8 }) => {
  const c = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--crit)", info: "var(--info)", muted: "var(--fg-subtle)" }[tone] || "var(--ok)";
  return (
    <span
      className={pulse ? "pulse-dot" : ""}
      style={{
        width: size, height: size, borderRadius: 999, background: c,
        display: "inline-block", flexShrink: 0,
        boxShadow: `0 0 0 3px ${c}25`,
      }}
    />
  );
};

// Sparkline — line + optional area fill
const Sparkline = ({ data, w = 120, h = 32, stroke = "var(--accent)", fill, filled = true, strokeWidth = 1.5, fillOpacity = 0.14 }) => {
  if (!data || data.length === 0) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const stepX = w / (data.length - 1 || 1);
  const points = data.map((v, i) => [i * stepX, h - ((v - min) / range) * (h - 4) - 2]);
  const path = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  // If fill not provided, derive from stroke via color-mix so we always get a valid alpha-blended fill
  const fillColor = fill || `color-mix(in oklch, ${stroke} ${fillOpacity * 100}%, transparent)`;
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      {filled && <path d={area} fill={fillColor} />}
      <path d={path} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

// Tiny vertical bars (for alerts/min)
const SparkBars = ({ data, w = 120, h = 32, color = "var(--fg-muted)" }) => {
  if (!data || !data.length) return null;
  const max = Math.max(...data, 1);
  const bw = w / data.length;
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      {data.map((v, i) => {
        const bh = (v / max) * (h - 2);
        return <rect key={i} x={i * bw + 0.5} y={h - bh} width={bw - 1} height={bh} rx={1} fill={v > 0 ? color : "var(--border)"} />;
      })}
    </svg>
  );
};

// Linear progress
const Progress = ({ value = 0, max = 100, tone = "accent", height = 4, label }) => {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const c = { accent: "var(--accent)", ok: "var(--ok)", warn: "var(--warn)", crit: "var(--crit)" }[tone] || "var(--accent)";
  return (
    <div style={{ width: "100%" }}>
      <div style={{
        width: "100%", height, background: "var(--card-2)",
        borderRadius: 999, overflow: "hidden",
        border: "1px solid var(--border)",
      }}>
        <div style={{ width: `${pct}%`, height: "100%", background: c, transition: "width 200ms ease" }} />
      </div>
      {label && <div className="mono" style={{ fontSize: 10, color: "var(--fg-subtle)", marginTop: 3 }}>{label}</div>}
    </div>
  );
};

// Severity tone helper
const sevTone = (sev) => ({ CRITICAL: "crit", WARNING: "warn", INFO: "info" }[sev] || "muted");
const statusTone = (s) => ({ healthy: "ok", warning: "warn", critical: "crit" }[s] || "muted");

// Time formatting
function relTime(ms) {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

Object.assign(window, { Pill, StatusDot, Sparkline, SparkBars, Progress, sevTone, statusTone, relTime });
