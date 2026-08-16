// Main app — composes pages + tweaks panel

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accent": "ember",
  "density": "comfortable",
  "kpiVariant": "strip"
}/*EDITMODE-END*/;

const ACCENTS = {
  ember:   { dark: "oklch(0.72 0.18 38)",  light: "oklch(0.65 0.20 38)" },
  blue:    { dark: "oklch(0.68 0.16 235)", light: "oklch(0.52 0.18 235)" },
  emerald: { dark: "oklch(0.72 0.14 162)", light: "oklch(0.52 0.16 162)" },
  amber:   { dark: "oklch(0.78 0.15 75)",  light: "oklch(0.58 0.16 75)" },
};

const App = () => {
  // useTweaks signature: [values, setTweak(key, val)]
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [active, setActive] = React.useState("overview");

  // Apply theme + accent + density to <html>
  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", tweaks.theme);
    root.setAttribute("data-density", tweaks.density);
    const a = ACCENTS[tweaks.accent] || ACCENTS.ember;
    const accent = a[tweaks.theme] || a.dark;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-soft", accent.replace(")", " / 0.14)"));
  }, [tweaks.theme, tweaks.accent, tweaks.density]);

  // Keyboard shortcuts: g→o/n/a/d
  React.useEffect(() => {
    let pending = null;
    const h = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (pending === "g") {
        pending = null;
        const map = { o: "overview", n: "nodes", a: "alerts", d: "diagnoses", t: "training", c: "chain" };
        if (map[e.key]) setActive(map[e.key]);
      } else {
        pending = e.key === "g" ? "g" : null;
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const criticalCount = ALERTS.filter(a => a.severity === "CRITICAL").length;
  const alertCount = ALERTS.length;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <Sidebar
        active={active}
        onNav={setActive}
        alertCount={alertCount}
        nodeCount={NODES.filter(n => n.status === "healthy").length}
      />

      <div style={{ marginLeft: "var(--sidebar-w)" }}>
        <Topbar
          theme={tweaks.theme}
          onTheme={(t) => setTweak("theme", t)}
          criticalCount={criticalCount}
          breadcrumb={active}
        />

        <main style={{ padding: "20px 24px 40px", maxWidth: 1600, margin: "0 auto" }}>
          {active === "overview" && <OverviewPage tweaks={tweaks} />}
          {active === "nodes" && <NodesPage density={tweaks.density} />}
          {active === "alerts" && <AlertsPage />}
          {active === "diagnoses" && <DiagnosesPage />}
          {active === "training" && <TrainingPage />}
          {active === "chain" && <AttestationsPage />}

          {/* Footer */}
          <div style={{
            marginTop: 32, padding: "16px 0", borderTop: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: 16,
            fontSize: 11, color: "var(--fg-subtle)",
          }} className="mono">
            <span>SolProbe v0.4.2</span>
            <span>·</span>
            <span>backend healthy · 7/8 sidecars</span>
            <span>·</span>
            <span>189 tests passing</span>
            <div style={{ flex: 1 }} />
            <span>g→o overview · g→n nodes · g→a alerts · g→d diagnoses · g→t training · g→c chain</span>
          </div>
        </main>
      </div>

      {/* Tweaks panel */}
      <TweaksPanel title="Tweaks">
        <TweakSection label="Theme">
          <TweakRadio
            label="Mode"
            value={tweaks.theme}
            onChange={(v) => setTweak("theme", v)}
            options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}
          />
        </TweakSection>

        <TweakSection label="Accent">
          <TweakRadio
            label="Hue"
            value={tweaks.accent}
            onChange={(v) => setTweak("accent", v)}
            options={[
              { value: "ember",   label: "Ember" },
              { value: "blue",    label: "Blue" },
              { value: "emerald", label: "Green" },
              { value: "amber",   label: "Amber" },
            ]}
          />
        </TweakSection>

        <TweakSection label="Layout">
          <TweakRadio
            label="Density"
            value={tweaks.density}
            onChange={(v) => setTweak("density", v)}
            options={[{ value: "comfortable", label: "Comfy" }, { value: "compact", label: "Compact" }]}
          />
          <TweakRadio
            label="KPI strip"
            value={tweaks.kpiVariant}
            onChange={(v) => setTweak("kpiVariant", v)}
            options={[{ value: "strip", label: "Cards" }, { value: "hero", label: "Unified" }]}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// OVERVIEW PAGE (the original landing page content)
// ──────────────────────────────────────────────────────────────────────────
const OverviewPage = ({ tweaks }) => (
  <>
    <PageHeader
      title="Cluster overview"
      subtitle={<>Real-time GPU fault detection across <span className="mono" style={{ color: "var(--fg)" }}>8 nodes</span> · last sync <span className="mono">2s ago</span></>}
      actions={
        <>
          <button style={btnGhostStyle}><I.Refresh size={12} /> Refresh</button>
          <button style={btnPrimaryStyle}><I.Plus size={12} /> Inject fault</button>
        </>
      }
    />

    <div style={{ marginBottom: 20 }}><KPIStrip variant={tweaks.kpiVariant} /></div>
    <div style={{ marginBottom: 20 }}><TrainingPanel /></div>

    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 20, marginBottom: 20 }}>
      <ClusterTable nodes={NODES} density={tweaks.density} />
      <div style={{ minHeight: 600 }}>
        <AlertsFeed alerts={ALERTS} />
      </div>
    </div>

    <DiagnosesPanel diagnoses={DIAGNOSES} />
  </>
);

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
