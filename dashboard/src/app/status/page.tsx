"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createSolProbeIncident, fetchHealth } from "@/lib/api";
import { useWebSocket } from "@/lib/websocket";
import type { HealthStatus, IncidentIoCreateResult, IncidentIoServiceRequest } from "@/lib/types";
import { Activity, ExternalLink, Server, Wifi, Workflow, Gauge } from "lucide-react";

type ComponentStatus = "operational" | "degraded" | "down";

interface StatusComponent {
  service: string;
  status: ComponentStatus;
  detail: string;
  icon: typeof Activity;
}

const STATUS_VARIANT: Record<ComponentStatus, "success" | "warning" | "destructive"> = {
  operational: "success",
  degraded: "warning",
  down: "destructive",
};

const PUBLIC_STATUS_PAGE_URL = process.env.NEXT_PUBLIC_STATUS_PAGE_URL?.trim();

export default function StatusPage() {
  const ws = useWebSocket();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [service, setService] = useState("SolProbe backend API");
  const [status, setStatus] = useState<IncidentIoServiceRequest["status"]>("degraded");
  const [summary, setSummary] = useState("");
  const [creating, setCreating] = useState(false);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [incident, setIncident] = useState<IncidentIoCreateResult | null>(null);

  useEffect(() => {
    fetchHealth()
      .then((next) => {
        setHealth(next);
        setHealthError(null);
      })
      .catch((err) => setHealthError(err instanceof Error ? err.message : "Health check failed"));
  }, []);

  const components = useMemo<StatusComponent[]>(() => {
    const backendStatus: ComponentStatus = healthError ? "down" : "operational";
    const sidecarStatus: ComponentStatus =
      healthError ? "down" : (health?.connected_sidecars ?? 0) > 0 ? "operational" : "degraded";
    const wsStatus: ComponentStatus = ws.connected ? "operational" : "degraded";
    return [
      {
        service: "SolProbe dashboard",
        status: "operational",
        detail: "Frontend is rendering locally.",
        icon: Activity,
      },
      {
        service: "SolProbe backend API",
        status: backendStatus,
        detail: healthError ? "Health endpoint is unreachable." : "Health endpoint is responding.",
        icon: Server,
      },
      {
        service: "SolProbe realtime stream",
        status: wsStatus,
        detail: ws.connected ? "WebSocket stream is connected." : "WebSocket stream is not connected.",
        icon: Wifi,
      },
      {
        service: "SolProbe sidecar ingest",
        status: sidecarStatus,
        detail: `${health?.connected_sidecars ?? 0} sidecar node${(health?.connected_sidecars ?? 0) === 1 ? "" : "s"} connected.`,
        icon: Workflow,
      },
      {
        service: "SolProbe detection pipeline",
        status: backendStatus,
        detail: healthError ? "Detector status depends on backend recovery." : `${health?.total_alerts ?? 0} alerts tracked.`,
        icon: Gauge,
      },
    ];
  }, [health, healthError, ws.connected]);

  const overallStatus: ComponentStatus = components.some((c) => c.status === "down")
    ? "down"
    : components.some((c) => c.status === "degraded")
      ? "degraded"
      : "operational";

  async function handleCreateIncident() {
    setCreating(true);
    setIncidentError(null);
    setIncident(null);
    try {
      const result = await createSolProbeIncident({
        service,
        status,
        summary: summary.trim() || undefined,
      });
      setIncident(result);
    } catch (err) {
      setIncidentError(err instanceof Error ? err.message : "Could not create incident");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="SolProbe Status"
        eyebrow="Operations"
        subtitle="Operational view for the SolProbe control plane and demo runtime."
        badge={<Badge variant={STATUS_VARIANT[overallStatus]}>{overallStatus}</Badge>}
      />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium">Public source of truth</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Use the external incident.io status page for customer-facing availability. This dashboard page is only an authenticated ops view.
            </p>
          </div>
          {PUBLIC_STATUS_PAGE_URL ? (
            <a
              href={PUBLIC_STATUS_PAGE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Open public status <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <Badge variant="warning">NEXT_PUBLIC_STATUS_PAGE_URL not set</Badge>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {components.map((component) => (
          <Card key={component.service}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <component.icon className="h-4 w-4 text-primary" />
                <Badge variant={STATUS_VARIANT[component.status]}>{component.status}</Badge>
              </div>
              <div>
                <div className="text-sm font-medium">{component.service}</div>
                <p className="mt-1 text-xs text-muted-foreground">{component.detail}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Open SolProbe incident</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Service</span>
              <Select value={service} onChange={(e) => setService(e.target.value)} className="w-full">
                {components.map((component) => (
                  <option key={component.service} value={component.service}>
                    {component.service}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Status</span>
              <Select value={status} onChange={(e) => setStatus(e.target.value as IncidentIoServiceRequest["status"])} className="w-full">
                <option value="degraded">degraded</option>
                <option value="down">down</option>
                <option value="maintenance">maintenance</option>
              </Select>
            </label>
          </div>
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Summary</span>
            <Textarea
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What is wrong with the SolProbe service?"
            />
          </label>
          {incidentError && <ErrorBanner title="Could not create incident" message={incidentError} />}
          {incident ? (
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">
                {incident.reference ?? "incident.io incident created"}
                <span className="ml-2 font-mono text-xs text-muted-foreground">{incident.mode}</span>
              </div>
              {incident.permalink && (
                <a
                  href={incident.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Open in incident.io <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ) : (
            <Button onClick={handleCreateIncident} disabled={creating}>
              {creating ? "Creating..." : "Create incident.io incident"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
