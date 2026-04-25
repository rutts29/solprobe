"""Alert fingerprinting for result-cache matching.

Two alerts should produce the SAME fingerprint iff reusing a prior diagnosis
for one is safe for the other. The fingerprint must be:

  - Specific enough: different root-cause-producing bugs get different fingerprints.
    (gradient spike magnitude 27 vs 287 → different fingerprints even on same node.)
  - Stable enough: trivial variations (exact timestamp, minor metric noise) don't
    prevent reuse of a valid diagnosis made seconds ago.

Fingerprint components (all must match for reuse):
  1. alert_type         — the semantic class
  2. node_id            — tied to specific hardware
  3. severity           — WARN vs CRITICAL may need different actions
  4. description template (numbers normalized to 'N')
  5. log-scale magnitude bucket of each numeric evidence value
  6. exact XID code if present (hardware-fault identifiers are categorical, not continuous)
"""

from __future__ import annotations

import hashlib
import math
import re

from app.models.alerts import AlertModel

_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _magnitude_bucket(value: float) -> str:
    """log10 bucket — 0.5 and 0.9 share bucket, 27 and 280 do not."""
    v = abs(value)
    if v < 1e-6:
        return "0"
    return str(int(math.floor(math.log10(v))))


def alert_fingerprint(alert: AlertModel) -> str:
    """Return a 16-char hash representing the alert's diagnosable identity."""
    parts: list[str] = [
        alert.alert_type,
        alert.node_id,
        alert.severity,
        _NUM_RE.sub("N", alert.description or ""),
    ]

    if alert.evidence:
        for key in sorted(alert.evidence.keys()):
            v_str = str(alert.evidence[key])
            # XID codes are categorical — bucket would be wrong, use exact value.
            if "xid" in key.lower():
                parts.append(f"{key}={v_str}")
                continue
            # Try to parse as a single number — if the whole value is numeric,
            # use a magnitude bucket so 27 and 287 don't collide.
            try:
                v_num = float(v_str)
                parts.append(f"{key}~{_magnitude_bucket(v_num)}")
            except ValueError:
                # Not purely numeric: normalize embedded numbers so "step 100"
                # and "step 200" fingerprint the same (step is rarely diagnostic).
                parts.append(f"{key}:{_NUM_RE.sub('N', v_str)}")

    digest = hashlib.sha256("|".join(parts).encode()).hexdigest()
    return digest[:16]
