"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestamp } from "@/lib/utils";
import type { ReactNode } from "react";
import {
  fetchPolicies,
  createPolicy,
  patchPolicy,
  deletePolicy,
  togglePolicy,
  fetchCustomMetricNames,
} from "@/lib/api";
import type {
  MonitoringPolicy,
  PolicyCreate,
  PolicyOperator,
  PolicySeverity,
  PolicySource,
} from "@/lib/types";

interface PolicyPreset {
  label: string;
  body: PolicyCreate;
}

const PRESETS: PolicyPreset[] = [
  {
    label: "Gradient norm warning",
    body: {
      policy_id: "grad-norm-warning",
      name: "Gradient norm warning",
      metric: { source: "training", field: "gradient_norm" },
      condition: { operator: "gt", threshold: 50, for_seconds: 5 },
      severity: "WARNING",
      cooldown_seconds: 60,
      description: "Gradient norm exceeded soft threshold",
    },
  },
  {
    label: "Gradient norm critical",
    body: {
      policy_id: "grad-norm-critical",
      name: "Gradient norm critical",
      metric: { source: "training", field: "gradient_norm" },
      condition: { operator: "gt", threshold: 100, for_seconds: 5 },
      severity: "CRITICAL",
      cooldown_seconds: 60,
      description: "Gradient norm exceeded safe range",
    },
  },
  {
    label: "Low throughput",
    body: {
      policy_id: "low-throughput",
      name: "Low throughput",
      metric: { source: "training", field: "throughput_tps" },
      condition: { operator: "lt", threshold: 10, for_seconds: 30 },
      severity: "WARNING",
      cooldown_seconds: 120,
      description: "Training throughput dropped below 10 tokens/sec",
    },
  },
  {
    label: "Training stalled",
    body: {
      policy_id: "training-stalled",
      name: "Training stalled",
      metric: { source: "training", field: "step" },
      condition: { operator: "stale_for", threshold: 0, for_seconds: 60 },
      severity: "CRITICAL",
      cooldown_seconds: 120,
      description: "Training step has not advanced for 60 seconds",
    },
  },
  {
    label: "High GPU memory",
    body: {
      policy_id: "high-gpu-memory",
      name: "High GPU memory",
      metric: { source: "gpu", field: "fb_used_mb" },
      condition: { operator: "gt", threshold: 14000, for_seconds: 10 },
      severity: "WARNING",
      cooldown_seconds: 60,
      description: "GPU framebuffer usage above 14 GB",
    },
  },
  {
    label: "Apple GPU utilization sustained high",
    body: {
      policy_id: "apple-gpu-util-high",
      name: "Apple GPU utilization sustained high",
      metric: { source: "gpu", field: "gpu_utilization_pct" },
      condition: { operator: "gt", threshold: 90, for_seconds: 30 },
      severity: "INFO",
      cooldown_seconds: 120,
      description: "GPU utilization above 90% for 30+ seconds",
    },
  },
];

const SOURCE_FIELDS: Record<Exclude<PolicySource, "custom">, string[]> = {
  gpu: [
    "gpu_temp_c",
    "gpu_utilization_pct",
    "fb_used_mb",
    "fb_free_mb",
    "power_usage_w",
    "sm_active_pct",
    "tensor_active_pct",
    "mem_copy_utilization_pct",
  ],
  training: ["loss", "gradient_norm", "throughput_tps", "mfu_pct", "learning_rate", "step"],
  diloco: [
    "inner_step",
    "outer_step",
    "inner_loss",
    "outer_loss",
    "pseudo_grad_norm",
    "sync_duration_ms",
    "worker_speed_ratio",
  ],
};

const OPERATORS: { value: PolicyOperator; label: string }[] = [
  { value: "gt", label: "greater than (>)" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "less than (<)" },
  { value: "lte", label: "≤" },
  { value: "abs_gt", label: "|x| greater than" },
  { value: "stale_for", label: "unchanged for" },
];

const SEVERITIES: PolicySeverity[] = ["INFO", "WARNING", "CRITICAL"];

function severityVariant(s: PolicySeverity): "default" | "secondary" | "destructive" {
  if (s === "CRITICAL") return "destructive";
  if (s === "WARNING") return "default";
  return "secondary";
}

const EMPTY_FORM: PolicyCreate = {
  policy_id: "",
  name: "",
  enabled: true,
  scope: { job_id: null, node_id: null },
  metric: { source: "training", field: "gradient_norm" },
  condition: { operator: "gt", threshold: 0, for_seconds: 0 },
  severity: "WARNING",
  cooldown_seconds: 60,
  description: "",
};

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<MonitoringPolicy[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PolicyCreate>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [customNames, setCustomNames] = useState<string[]>([]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchPolicies();
      if (signal?.aborted) return;
      setPolicies(data);
      setError(null);
      setLoadedOnce(true);
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to fetch policies");
      setLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    const interval = setInterval(() => refresh(controller.signal), 5000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [refresh]);

  function openCreateDrawer(initial?: PolicyCreate) {
    setEditingId(null);
    setForm(initial ?? EMPTY_FORM);
    setDrawerOpen(true);
  }

  function openEditDrawer(p: MonitoringPolicy) {
    setEditingId(p.policy_id);
    setForm({
      policy_id: p.policy_id,
      name: p.name,
      enabled: p.enabled,
      scope: p.scope,
      metric: p.metric,
      condition: p.condition,
      severity: p.severity,
      cooldown_seconds: p.cooldown_seconds,
      description: p.description,
    });
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditingId(null);
    setError(null);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      if (editingId) {
        const patch = { ...form } as Partial<PolicyCreate>;
        delete patch.policy_id;
        await patchPolicy(editingId, patch);
      } else {
        await createPolicy(form);
      }
      await refresh();
      closeDrawer();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save policy");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(policyId: string) {
    try {
      await togglePolicy(policyId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle policy");
    }
  }

  async function handleDelete(policyId: string) {
    if (!window.confirm(`Delete policy "${policyId}"?`)) return;
    try {
      await deletePolicy(policyId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete policy");
    }
  }

  const sourceFieldOptions = useMemo(
    () =>
      form.metric.source === "custom"
        ? []
        : SOURCE_FIELDS[form.metric.source] ?? [],
    [form.metric.source],
  );

  useEffect(() => {
    if (!drawerOpen || form.metric.source !== "custom") return;
    let cancelled = false;
    fetchCustomMetricNames(form.scope?.job_id ?? undefined)
      .then((names) => {
        if (!cancelled) setCustomNames(names);
      })
      .catch(() => {
        if (!cancelled) setCustomNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [drawerOpen, form.metric.source, form.scope?.job_id]);

  if (!loadedOnce) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Monitoring policies"
          eyebrow="Monitoring"
          subtitle="User-defined thresholds over training and hardware metrics. Violations raise alerts."
        />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const policyColumns: DataTableColumn<MonitoringPolicy>[] = [
    {
      key: "name",
      header: "Name",
      cell: (p) => (
        <>
          <button
            className="text-left font-medium hover:underline"
            onClick={() => openEditDrawer(p)}
          >
            {p.name}
          </button>
          <div className="font-mono text-xs text-muted-foreground">{p.policy_id}</div>
        </>
      ),
    },
    {
      key: "source",
      header: "Source",
      cell: (p) => <span className="font-mono text-xs">{p.metric.source}</span>,
    },
    {
      key: "field",
      header: "Field",
      cell: (p) => <span className="font-mono text-xs">{p.metric.field}</span>,
    },
    {
      key: "condition",
      header: "Condition",
      cell: (p) => (
        <span className="font-mono text-xs">
          {p.condition.operator === "stale_for"
            ? `unchanged for ${p.condition.for_seconds}s`
            : `${p.condition.operator} ${p.condition.threshold}${p.condition.for_seconds > 0 ? ` for ${p.condition.for_seconds}s` : ""}`}
        </span>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      cell: (p) => <Badge variant={severityVariant(p.severity)}>{p.severity}</Badge>,
    },
    {
      key: "last-triggered",
      header: "Last triggered",
      cell: (p) => (
        <span className="text-xs text-muted-foreground">
          {p.last_triggered_at_ms ? formatTimestamp(p.last_triggered_at_ms) : "-"}
        </span>
      ),
    },
    {
      key: "enabled",
      header: "Enabled",
      cell: (p) => (
        <button
          onClick={() => handleToggle(p.policy_id)}
          className={`rounded-md border px-2 py-1 text-xs ${
            p.enabled
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : "border-border bg-muted text-muted-foreground"
          }`}
        >
          {p.enabled ? "on" : "off"}
        </button>
      ),
    },
    {
      key: "delete",
      header: "",
      align: "right",
      cell: (p) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleDelete(p.policy_id)}
        >
          Delete
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoring policies"
        eyebrow="Monitoring"
        subtitle="User-defined thresholds over training and hardware metrics. Violations raise alerts."
        actions={<Button onClick={() => openCreateDrawer()}>New policy</Button>}
      />

      {error && <ErrorBanner title="Policy request failed" message={error} />}

      <Card>
        <CardHeader>
          <CardTitle>Presets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => {
              const exists = policies.some((existing) => existing.policy_id === p.body.policy_id);
              return (
                <Button
                  key={p.body.policy_id}
                  variant="outline"
                  size="sm"
                  disabled={exists}
                  onClick={() => openCreateDrawer(p.body)}
                  title={exists ? "Already added" : "Click to fill the form"}
                >
                  {p.label}
                  {exists && <span className="ml-2 text-xs text-muted-foreground">(added)</span>}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All policies ({policies.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {policies.length === 0 ? (
            <EmptyState title="No policies yet" description="Click a preset above or create a custom monitoring policy." />
          ) : (
            <DataTable
              columns={policyColumns}
              rows={policies}
              rowKey={(policy) => policy.policy_id}
            />
          )}
        </CardContent>
      </Card>

      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={closeDrawer}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="absolute right-0 top-0 h-full w-full max-w-md border-l bg-card p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-4">
              <h2 className="text-lg font-semibold">
                {editingId ? "Edit policy" : "New policy"}
              </h2>
              <button onClick={closeDrawer} className="text-sm text-muted-foreground hover:text-foreground">
                Close
              </button>
            </div>

            <div className="space-y-4">
              <Field label="Policy ID">
                <input
                  type="text"
                  className="h-8 w-full rounded-md border bg-background px-2.5 text-sm font-mono"
                  value={form.policy_id}
                  disabled={!!editingId}
                  onChange={(e) => setForm({ ...form, policy_id: e.target.value })}
                />
              </Field>

              <Field label="Name">
                <input
                  type="text"
                  className="h-8 w-full rounded-md border bg-background px-2.5 text-sm"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Source">
                  <Select
                    className="w-full"
                    value={form.metric.source}
                    onChange={(e) => {
                      const source = e.target.value as PolicySource;
                      const initialField =
                        source === "custom" ? "" : SOURCE_FIELDS[source][0] ?? "";
                      setForm({
                        ...form,
                        metric: { source, field: initialField },
                      });
                    }}
                  >
                    <option value="gpu">gpu</option>
                    <option value="training">training</option>
                    <option value="diloco">diloco</option>
                    <option value="custom">custom</option>
                  </Select>
                </Field>
                <Field label={form.metric.source === "custom" ? "Metric name" : "Field"}>
                  {form.metric.source === "custom" ? (
                    <>
                      <input
                        type="text"
                        list="policy-custom-metric-names"
                        placeholder="e.g. eval_bpb"
                        className="h-8 w-full rounded-md border bg-background px-2.5 text-sm font-mono"
                        value={form.metric.field}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            metric: { ...form.metric, field: e.target.value },
                          })
                        }
                      />
                      <datalist id="policy-custom-metric-names">
                        {customNames.map((n) => (
                          <option key={n} value={n} />
                        ))}
                      </datalist>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Must match the name your training script logs via
                        <code className="ml-1 font-mono">cb.log_metric(...)</code>.
                      </p>
                    </>
                  ) : (
                    <Select
                      className="w-full font-mono"
                      value={form.metric.field}
                      onChange={(e) =>
                        setForm({ ...form, metric: { ...form.metric, field: e.target.value } })
                      }
                    >
                      {sourceFieldOptions.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>

              <Field label="Operator">
                <Select
                  className="w-full"
                  value={form.condition.operator}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      condition: { ...form.condition, operator: e.target.value as PolicyOperator },
                    })
                  }
                >
                  {OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>

              {form.condition.operator !== "stale_for" && (
                <Field label="Threshold">
                  <input
                    type="number"
                    step="any"
                    className="h-8 w-full rounded-md border bg-background px-2.5 text-sm font-mono"
                    value={form.condition.threshold}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        condition: { ...form.condition, threshold: parseFloat(e.target.value) || 0 },
                      })
                    }
                  />
                </Field>
              )}

              <Field label="Duration (seconds)">
                <input
                  type="number"
                  step="1"
                  min="0"
                  className="h-8 w-full rounded-md border bg-background px-2.5 text-sm font-mono"
                  value={form.condition.for_seconds}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      condition: { ...form.condition, for_seconds: parseFloat(e.target.value) || 0 },
                    })
                  }
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Severity">
                  <Select
                    className="w-full"
                    value={form.severity}
                    onChange={(e) =>
                      setForm({ ...form, severity: e.target.value as PolicySeverity })
                    }
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Cooldown (seconds)">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="h-8 w-full rounded-md border bg-background px-2.5 text-sm font-mono"
                    value={form.cooldown_seconds}
                    onChange={(e) =>
                      setForm({ ...form, cooldown_seconds: parseFloat(e.target.value) || 0 })
                    }
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Scope: node_id">
                  <input
                    type="text"
                    placeholder="(any)"
                    className="h-8 w-full rounded-md border bg-background px-2.5 text-sm font-mono"
                    value={form.scope?.node_id ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        scope: {
                          job_id: form.scope?.job_id ?? null,
                          node_id: e.target.value.trim() || null,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Scope: job_id">
                  <input
                    type="text"
                    placeholder="(any)"
                    className="h-8 w-full rounded-md border bg-background px-2.5 text-sm font-mono"
                    value={form.scope?.job_id ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        scope: {
                          node_id: form.scope?.node_id ?? null,
                          job_id: e.target.value.trim() || null,
                        },
                      })
                    }
                  />
                </Field>
              </div>

              <Field label="Description">
                <textarea
                  rows={2}
                  className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
                  value={form.description ?? ""}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={closeDrawer}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Saving..." : editingId ? "Save changes" : "Create"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
