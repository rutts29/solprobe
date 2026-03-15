output "cluster_endpoint" {
  description = "GKE cluster endpoint"
  value       = google_container_cluster.solprobe.endpoint
  sensitive   = true
}

output "cluster_ca_certificate" {
  description = "GKE cluster CA certificate"
  value       = google_container_cluster.solprobe.master_auth[0].cluster_ca_certificate
  sensitive   = true
}

output "cluster_name" {
  description = "GKE cluster name"
  value       = google_container_cluster.solprobe.name
}

output "region" {
  description = "GCP region"
  value       = var.region
}

output "kubectl_command" {
  description = "Command to configure kubectl"
  value       = "gcloud container clusters get-credentials ${google_container_cluster.solprobe.name} --region ${var.region} --project ${var.project_id}"
}

output "checkpoints_bucket" {
  description = "GCS bucket for training checkpoints"
  value       = google_storage_bucket.checkpoints.name
}
