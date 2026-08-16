// SolProbe logo explorations — rebuilt with DCSection / DCArtboard children

const V = ({ bg, children, label, palette, concept }) => (
  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#fafafa' }}>
    <div style={{ flex: 1, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #e4e4e7' }}>
      {children}
    </div>
    <div style={{ padding: '12px 16px', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>{label}</div>
      <div style={{ fontSize: 11, color: '#71717a', marginTop: 2 }}>{concept}</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        {palette.map((c, i) => (
          <div key={i} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid rgba(0,0,0,0.08)' }} />
        ))}
      </div>
    </div>
  </div>
);

// ── Marks ──
const V01 = () => (
  <svg viewBox="0 0 120 120" width="110" height="110">
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#0a0a0f"/>
    <g stroke="#fafafa" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none">
      <path d="M22 68 H40 L48 48 L56 86 L64 54 L72 72 H98"/>
    </g>
    <circle cx="64" cy="54" r="6" fill="#FF6B35"/>
  </svg>
);
const V02 = () => (
  <svg viewBox="0 0 120 120" width="110" height="110">
    <defs><linearGradient id="g02" x1="0" y1="0" x2="120" y2="120"><stop offset="0" stopColor="#0f172a"/><stop offset="1" stopColor="#1e293b"/></linearGradient></defs>
    <rect x="4" y="4" width="112" height="112" rx="24" fill="url(#g02)"/>
    <g stroke="#22D3EE" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M22 68 H40 L48 48 L56 86 L64 54 L72 72 H98"/></g>
    <circle cx="64" cy="54" r="6" fill="#fafafa"/>
  </svg>
);
const V03 = () => (
  <svg viewBox="0 0 120 120" width="110" height="110">
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#f5f5f4" stroke="#0a0a0f" strokeWidth="2"/>
    <g stroke="#0a0a0f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M22 68 H40 L48 48 L56 86 L64 54 L72 72 H98"/></g>
    <circle cx="64" cy="54" r="5" fill="#0a0a0f"/>
  </svg>
);
const V04 = () => (
  <svg viewBox="0 0 120 120" width="110" height="110">
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#1a0a0a"/>
    <circle cx="60" cy="60" r="30" fill="none" stroke="#dc2626" strokeWidth="1.5" opacity="0.5"/>
    <circle cx="60" cy="60" r="20" fill="none" stroke="#dc2626" strokeWidth="1.5" opacity="0.7"/>
    <g stroke="#fafafa" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M28 68 H44 L50 52 L58 80 L64 58 L70 72 H92"/></g>
    <circle cx="64" cy="58" r="5" fill="#dc2626"/>
  </svg>
);
const V05 = () => (
  <svg viewBox="0 0 120 120" width="110" height="110">
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#022c22"/>
    <g stroke="#10B981" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M22 68 H40 L48 48 L56 86 L64 54 L72 72 H98"/></g>
    <circle cx="64" cy="54" r="6" fill="#FDE047"/>
  </svg>
);
const V06 = () => (
  <svg viewBox="0 0 120 120" width="110" height="110">
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#C2410C"/>
    <g stroke="#FEF3C7" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M22 68 H40 L48 48 L56 86 L64 54 L72 72 H98"/></g>
    <circle cx="64" cy="54" r="6" fill="#FEF3C7"/>
  </svg>
);
const V07 = () => (
  <svg viewBox="0 0 120 120" width="110" height="110">
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#1E3A8A"/>
    <g stroke="#fafafa" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M22 68 H40 L48 48 L56 86 L64 54 L72 72 H98"/></g>
    <circle cx="64" cy="54" r="6" fill="#FBBF24"/>
  </svg>
);
const V08 = () => (
  <svg viewBox="0 0 120 120" width="110" height="110">
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#27272a"/>
    <g stroke="#fafafa" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M22 68 H40 L48 48 L56 86 L64 54 L72 72 H98"/></g>
    <circle cx="64" cy="54" r="6" fill="#F59E0B"/>
  </svg>
);
const V09 = () => (
  <svg viewBox="0 0 120 120" width="110" height="110">
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#0a0a0f"/>
    <circle cx="60" cy="60" r="28" fill="none" stroke="#fafafa" strokeWidth="2.5"/>
    <line x1="60" y1="22" x2="60" y2="38" stroke="#fafafa" strokeWidth="2.5"/>
    <line x1="60" y1="82" x2="60" y2="98" stroke="#fafafa" strokeWidth="2.5"/>
    <line x1="22" y1="60" x2="38" y2="60" stroke="#fafafa" strokeWidth="2.5"/>
    <line x1="82" y1="60" x2="98" y2="60" stroke="#fafafa" strokeWidth="2.5"/>
    <circle cx="60" cy="60" r="7" fill="#FF6B35"/>
  </svg>
);
const V10 = () => (
  <svg viewBox="0 0 120 120" width="110" height="110">
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#0f172a"/>
    <polygon points="60,22 92,40 92,80 60,98 28,80 28,40" fill="none" stroke="#22D3EE" strokeWidth="3"/>
    {[[60,22],[92,40],[92,80],[60,98],[28,80],[28,40]].map(([x,y],i)=>(<circle key={i} cx={x} cy={y} r="4" fill="#22D3EE"/>))}
    <circle cx="60" cy="60" r="8" fill="#fafafa"/>
  </svg>
);
const V11 = () => (
  <svg viewBox="0 0 120 120" width="110" height="110">
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#fafafa" stroke="#0a0a0f" strokeWidth="2"/>
    <text x="60" y="78" textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="54" fontWeight="700" fill="#0a0a0f" letterSpacing="-0.04em">sp</text>
    <circle cx="95" cy="30" r="5" fill="#FF6B35"/>
  </svg>
);
const V12 = () => (
  <svg viewBox="0 0 120 120" width="110" height="110">
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#18181b"/>
    <line x1="22" y1="60" x2="98" y2="60" stroke="#3f3f46" strokeWidth="1" strokeDasharray="3 3"/>
    <g stroke="#fafafa" strokeWidth="3" strokeLinecap="round" fill="none"><path d="M22 60 L32 60 L36 54 L40 60 L48 60 L52 40 L56 80 L60 48 L64 72 L68 58 L76 60 L82 54 L88 60 L98 60"/></g>
    <circle cx="56" cy="80" r="4" fill="#EF4444"/>
  </svg>
);

// Small marks for lockups / previews
const Mark01 = ({ size = 56 }) => (
  <svg viewBox="0 0 120 120" width={size} height={size}>
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#0a0a0f"/>
    <g stroke="#fafafa" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M22 68 H40 L48 48 L56 86 L64 54 L72 72 H98"/></g>
    <circle cx="64" cy="54" r="6" fill="#FF6B35"/>
  </svg>
);
const Mark02 = ({ size = 56 }) => (
  <svg viewBox="0 0 120 120" width={size} height={size}>
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#0f172a"/>
    <g stroke="#22D3EE" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M22 68 H40 L48 48 L56 86 L64 54 L72 72 H98"/></g>
    <circle cx="64" cy="54" r="6" fill="#fafafa"/>
  </svg>
);
const Mark06 = ({ size = 56 }) => (
  <svg viewBox="0 0 120 120" width={size} height={size}>
    <rect x="4" y="4" width="112" height="112" rx="24" fill="#C2410C"/>
    <g stroke="#FEF3C7" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M22 68 H40 L48 48 L56 86 L64 54 L72 72 H98"/></g>
    <circle cx="64" cy="54" r="6" fill="#FEF3C7"/>
  </svg>
);

const Wordmark = ({ bg, textColor, fadeColor, children }) => (
  <div style={{ width: '100%', height: '100%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
    {children}
    <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 36, letterSpacing: '-0.03em', color: textColor }}>
      Sol<span style={{ color: fadeColor, fontWeight: 500 }}>Probe</span>
    </div>
  </div>
);

const DashboardPreview = ({ mark, brandText = '#0a0a0f', fadeText = '#52525b', bg = '#fafafa', sidebarBg = '#fff', border = '#e4e4e7' }) => (
  <div style={{ width: '100%', height: '100%', background: bg, display: 'grid', gridTemplateColumns: '180px 1fr', borderRadius: 6, overflow: 'hidden', fontFamily: 'Inter, sans-serif' }}>
    <div style={{ background: sidebarBg, borderRight: `1px solid ${border}`, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
        {mark}
        <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.02em', color: brandText }}>Sol<span style={{ color: fadeText, fontWeight: 500 }}>Probe</span></div>
      </div>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#a1a1aa', marginBottom: 6 }}>Monitoring</div>
      {['Overview','Nodes','Alerts','Diagnoses','Training'].map((n,i) => (
        <div key={n} style={{ fontSize: 11, padding: '5px 8px', borderRadius: 4, background: i===0?'rgba(0,0,0,0.05)':'transparent', color: i===0?brandText:fadeText, marginBottom: 2 }}>{n}</div>
      ))}
    </div>
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.015em', marginBottom: 10, color: brandText }}>Cluster Overview</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {[['Nodes','12'],['Util','87%'],['Alerts','3'],['Throughput','12.4k']].map(([l,v]) => (
          <div key={l} style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 10, background: sidebarBg }}>
            <div style={{ fontSize: 9, textTransform: 'uppercase', color: '#a1a1aa', letterSpacing: '0.06em', fontWeight: 600 }}>{l}</div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 2, color: brandText }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const App = () => (
  <DesignCanvas>
    <DCSection id="primary" title="8 palette directions" subtitle="Same waveform mark, very different palettes — pick a vibe first.">
      <DCArtboard id="v01" label="01 — Ink & Ember" width={280} height={280}><V bg="#fafafa" label="Ink & Ember" concept="Black + single orange accent dot. Confident, restrained." palette={['#0a0a0f','#fafafa','#FF6B35']}><V01/></V></DCArtboard>
      <DCArtboard id="v02" label="02 — Midnight Cyan" width={280} height={280}><V bg="#fafafa" label="Midnight Cyan" concept="Deep navy + electric teal. Reads as 'instrument'." palette={['#0f172a','#22D3EE','#fafafa']}><V02/></V></DCArtboard>
      <DCArtboard id="v03" label="03 — Paper & Ink" width={280} height={280}><V bg="#fafafa" label="Paper & Ink" concept="Editorial. All-black on cream, outlined tile." palette={['#f5f5f4','#0a0a0f']}><V03/></V></DCArtboard>
      <DCArtboard id="v04" label="04 — Crimson Beacon" width={280} height={280}><V bg="#fafafa" label="Crimson Beacon" concept="Radar/alert energy. Deep red rings + white trace." palette={['#1a0a0a','#dc2626','#fafafa']}><V04/></V></DCArtboard>
      <DCArtboard id="v05" label="05 — Forest Systems" width={280} height={280}><V bg="#fafafa" label="Forest Systems" concept="Deep green + emerald + signal yellow. Terminal feel." palette={['#022c22','#10B981','#FDE047']}><V05/></V></DCArtboard>
      <DCArtboard id="v06" label="06 — Burnt Clay" width={280} height={280}><V bg="#fafafa" label="Burnt Clay" concept="Terracotta + cream. Braun / industrial warmth." palette={['#C2410C','#FEF3C7']}><V06/></V></DCArtboard>
      <DCArtboard id="v07" label="07 — Cobalt Graph" width={280} height={280}><V bg="#fafafa" label="Cobalt Graph" concept="Deep cobalt + signal amber. Serious, enterprise." palette={['#1E3A8A','#fafafa','#FBBF24']}><V07/></V></DCArtboard>
      <DCArtboard id="v08" label="08 — Ash & Amber" width={280} height={280}><V bg="#fafafa" label="Ash & Amber" concept="Neutral graphite + warm amber. Understated." palette={['#27272a','#fafafa','#F59E0B']}><V08/></V></DCArtboard>
    </DCSection>

    <DCSection id="alt" title="Alternative mark concepts" subtitle="Different metaphors for the same idea.">
      <DCArtboard id="v09" label="09 — Crosshair" width={280} height={280}><V bg="#fafafa" label="Crosshair / Target" concept="Probe = precision targeting. Center dot is the finding." palette={['#0a0a0f','#fafafa','#FF6B35']}><V09/></V></DCArtboard>
      <DCArtboard id="v10" label="10 — Hex Cluster" width={280} height={280}><V bg="#fafafa" label="Hex Cluster" concept="Distributed nodes with a central coordinator." palette={['#0f172a','#22D3EE','#fafafa']}><V10/></V></DCArtboard>
      <DCArtboard id="v11" label="11 — SP Monogram" width={280} height={280}><V bg="#fafafa" label="SP Monogram" concept="Mono-type 'sp' + accent dot. Ultra-simple." palette={['#fafafa','#0a0a0f','#FF6B35']}><V11/></V></DCArtboard>
      <DCArtboard id="v12" label="12 — Seismograph" width={280} height={280}><V bg="#fafafa" label="Seismograph" concept="Longer probe trace on baseline, one red spike." palette={['#18181b','#fafafa','#EF4444']}><V12/></V></DCArtboard>
    </DCSection>

    <DCSection id="word" title="Wordmark lockups (top 3)" subtitle="The mark sitting next to the name.">
      <DCArtboard id="w01" label="01 — Ink & Ember" width={420} height={120}><Wordmark bg="#fafafa" textColor="#0a0a0f" fadeColor="#71717a"><Mark01/></Wordmark></DCArtboard>
      <DCArtboard id="w02" label="02 — Midnight Cyan" width={420} height={120}><Wordmark bg="#fafafa" textColor="#0f172a" fadeColor="#64748b"><Mark02/></Wordmark></DCArtboard>
      <DCArtboard id="w06" label="06 — Burnt Clay" width={420} height={120}><Wordmark bg="#fafafa" textColor="#0a0a0f" fadeColor="#71717a"><Mark06/></Wordmark></DCArtboard>
      <DCArtboard id="w01d" label="01 on dark" width={420} height={120}><Wordmark bg="#0a0a0f" textColor="#fafafa" fadeColor="#a1a1aa"><Mark01/></Wordmark></DCArtboard>
      <DCArtboard id="w02d" label="02 on dark" width={420} height={120}><Wordmark bg="#0f172a" textColor="#fafafa" fadeColor="#94a3b8"><Mark02/></Wordmark></DCArtboard>
      <DCArtboard id="w06d" label="06 on dark" width={420} height={120}><Wordmark bg="#18181b" textColor="#FEF3C7" fadeColor="#a8a29e"><Mark06/></Wordmark></DCArtboard>
    </DCSection>

    <DCSection id="context" title="In the dashboard" subtitle="See each direction living in the product.">
      <DCArtboard id="c01" label="01 — Ink & Ember in app" width={640} height={320}><DashboardPreview mark={<Mark01 size={22}/>}/></DCArtboard>
      <DCArtboard id="c02" label="02 — Midnight Cyan in app" width={640} height={320}><DashboardPreview mark={<Mark02 size={22}/>}/></DCArtboard>
      <DCArtboard id="c06" label="06 — Burnt Clay in app" width={640} height={320}><DashboardPreview mark={<Mark06 size={22}/>}/></DCArtboard>
    </DCSection>
  </DesignCanvas>
);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
