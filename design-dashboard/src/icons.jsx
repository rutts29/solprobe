// Lightweight inline SVG icons (no external deps)
// All take size + className; stroke uses currentColor.

const Icon = ({ children, size = 16, className = "", viewBox = "0 0 24 24" }) => (
  <svg
    width={size} height={size} viewBox={viewBox}
    fill="none" stroke="currentColor" strokeWidth="1.75"
    strokeLinecap="round" strokeLinejoin="round"
    className={className} aria-hidden="true"
  >{children}</svg>
);

const I = {
  Activity: (p) => <Icon {...p}><path d="M3 12h4l3-9 4 18 3-9h4"/></Icon>,
  Grid:     (p) => <Icon {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Icon>,
  Server:   (p) => <Icon {...p}><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><circle cx="7" cy="7.5" r="0.6" fill="currentColor"/><circle cx="7" cy="16.5" r="0.6" fill="currentColor"/></Icon>,
  Alert:    (p) => <Icon {...p}><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></Icon>,
  Brain:    (p) => <Icon {...p}><path d="M9.5 2A2.5 2.5 0 0 0 7 4.5v15A2.5 2.5 0 0 0 9.5 22h0a2.5 2.5 0 0 0 2.5-2.5v-15A2.5 2.5 0 0 0 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 1 17 4.5v15a2.5 2.5 0 0 1-2.5 2.5h0a2.5 2.5 0 0 1-2.5-2.5v-15A2.5 2.5 0 0 1 14.5 2Z"/></Icon>,
  Coin:     (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M9 9.5h5a2 2 0 0 1 0 4H9m0 0h6"/></Icon>,
  Cpu:      (p) => <Icon {...p}><rect x="5" y="5" width="14" height="14" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="0.5"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></Icon>,
  Bolt:     (p) => <Icon {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></Icon>,
  Search:   (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></Icon>,
  Cmd:      (p) => <Icon {...p}><path d="M9 6V5a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v1m0 0v12m0 0v1a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3v-1m0 0V6"/></Icon>,
  Sun:      (p) => <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></Icon>,
  Moon:     (p) => <Icon {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></Icon>,
  ChevR:    (p) => <Icon {...p}><path d="m9 6 6 6-6 6"/></Icon>,
  ChevD:    (p) => <Icon {...p}><path d="m6 9 6 6 6-6"/></Icon>,
  Dot:      (p) => <Icon {...p}><circle cx="12" cy="12" r="3" fill="currentColor"/></Icon>,
  Filter:   (p) => <Icon {...p}><path d="M3 5h18l-7 9v6l-4-2v-4L3 5Z"/></Icon>,
  Plus:     (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>,
  Refresh:  (p) => <Icon {...p}><path d="M3 12a9 9 0 0 1 15.7-6L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.7 6L3 16M3 21v-5h5"/></Icon>,
  Wifi:     (p) => <Icon {...p}><path d="M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.43a5 5 0 0 1 7 0"/><path d="M12 20h.01"/></Icon>,
  X:        (p) => <Icon {...p}><path d="M18 6 6 18M6 6l12 12"/></Icon>,
  Check:    (p) => <Icon {...p}><path d="M20 6 9 17l-5-5"/></Icon>,
  Settings: (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></Icon>,
  Bell:     (p) => <Icon {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></Icon>,
  Shield:   (p) => <Icon {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></Icon>,
  Flame:    (p) => <Icon {...p}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 17c0 1-2 2-2 4h6c0-2-2-3-2-4a2.5 2.5 0 0 0 2.5-2.5C15.5 12 14 11 13 9c-1.5-3 1-6-3-7-1 4-3 6-3 9 0 1.5 1 2.5 1.5 3.5Z"/></Icon>,
  Wave:     (p) => <Icon {...p}><path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/></Icon>,
  Layers:   (p) => <Icon {...p}><path d="m12 2 10 6-10 6L2 8l10-6Z"/><path d="m2 14 10 6 10-6"/></Icon>,
  Box:      (p) => <Icon {...p}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></Icon>,
  Zap:      (p) => <Icon {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></Icon>,
  ArrowUp:  (p) => <Icon {...p}><path d="m18 15-6-6-6 6"/></Icon>,
  ArrowDn:  (p) => <Icon {...p}><path d="m6 9 6 6 6-6"/></Icon>,
  Eye:      (p) => <Icon {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></Icon>,
};

window.I = I;
