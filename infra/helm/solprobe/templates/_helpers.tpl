{{/*
Common labels
*/}}
{{- define "solprobe.labels" -}}
app.kubernetes.io/part-of: solprobe
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/*
Backend labels
*/}}
{{- define "solprobe.backend.labels" -}}
app: solprobe-backend
{{ include "solprobe.labels" . }}
{{- end }}

{{/*
Sidecar labels
*/}}
{{- define "solprobe.sidecar.labels" -}}
app: solprobe-sidecar
{{ include "solprobe.labels" . }}
{{- end }}

{{/*
Dashboard labels
*/}}
{{- define "solprobe.dashboard.labels" -}}
app: solprobe-dashboard
{{ include "solprobe.labels" . }}
{{- end }}

{{/*
Namespace
*/}}
{{- define "solprobe.namespace" -}}
{{ .Values.global.namespace | default "solprobe" }}
{{- end }}
